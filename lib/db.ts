import { Pool, type QueryResultRow } from "pg";
import { createNoteId, isCanonicalNoteId } from "./note-id";

declare global {
  // eslint-disable-next-line no-var
  var __agentnotePool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __agentnoteSchemaReady: Promise<void> | undefined;
}

function isTransientDbError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : "";
  const code =
    "code" in error && typeof error.code === "string" ? error.code : "";
  return (
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "57P01" || // admin_shutdown
    code === "57P03" || // cannot_connect_now
    message.includes("Connection terminated") ||
    message.includes("connection is closed") ||
    message.includes("Client has encountered a connection error")
  );
}

function resetPool() {
  const pool = global.__agentnotePool;
  global.__agentnotePool = undefined;
  global.__agentnoteSchemaReady = undefined;
  if (pool) {
    void pool.end().catch(() => {});
  }
}

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
    // Serverless + Railway TCP proxy: keep the pool tiny and short-lived so
    // idle proxy cuts do not leave warm lambdas holding dead sockets.
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });

  pool.on("error", (error) => {
    console.error("pg pool error", error);
    if (global.__agentnotePool === pool) {
      resetPool();
    }
  });

  return pool;
}

export function getPool() {
  if (!global.__agentnotePool) {
    global.__agentnotePool = createPool();
  }
  return global.__agentnotePool;
}

/** Rewrite non–Meet-style PKs to Meet codes; keep aliases so old URLs still resolve. */
async function migrateLegacyNoteIds(pool: Pool) {
  const legacy = await pool.query<{ id: string }>(
    `SELECT id FROM notes
     WHERE id !~ '^[abcdefghijkmnopqrstuvwxyz]{3}-[abcdefghijkmnopqrstuvwxyz]{4}-[abcdefghijkmnopqrstuvwxyz]{3}$'`,
  );

  for (const { id: oldId } of legacy.rows) {
    if (isCanonicalNoteId(oldId)) continue;

    let migrated = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const newId = createNoteId();
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const updated = await client.query(
          `UPDATE notes SET id = $1 WHERE id = $2`,
          [newId, oldId],
        );
        if ((updated.rowCount ?? 0) === 0) {
          await client.query("ROLLBACK");
          migrated = true;
          break;
        }
        await client.query(
          `INSERT INTO note_aliases (alias, note_id)
           VALUES ($1, $2)
           ON CONFLICT (alias) DO UPDATE SET note_id = EXCLUDED.note_id`,
          [oldId, newId],
        );
        await client.query("COMMIT");
        migrated = true;
        break;
      } catch (error) {
        await client.query("ROLLBACK");
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as { code: unknown }).code)
            : "";
        if (code === "23505") continue;
        console.error("migrate note id failed", { oldId, error });
        break;
      } finally {
        client.release();
      }
    }
    if (!migrated) {
      console.error("migrate note id exhausted retries", { oldId });
    }
  }
}

async function runSchemaMigrations(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Legacy installs used UUID; widen so short / Meet-style ids can be stored.
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'notes'
          AND column_name = 'id'
          AND data_type = 'uuid'
      ) THEN
        ALTER TABLE notes ALTER COLUMN id TYPE TEXT USING id::text;
      END IF;
    END $$;
  `);
  // Existing deployments created notes without user_id — add nullable first.
  await pool.query(`
    ALTER TABLE notes ADD COLUMN IF NOT EXISTS user_id TEXT;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS notes_user_updated_at_idx
    ON notes (user_id, updated_at DESC);
  `);
  // Only enforce NOT NULL once legacy rows are backfilled (see README).
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'notes'
          AND column_name = 'user_id'
          AND is_nullable = 'YES'
      ) AND NOT EXISTS (
        SELECT 1 FROM notes WHERE user_id IS NULL
      ) THEN
        ALTER TABLE notes ALTER COLUMN user_id SET NOT NULL;
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS note_aliases (
      alias TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES notes(id) ON UPDATE CASCADE ON DELETE CASCADE
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS note_aliases_note_id_idx
    ON note_aliases (note_id);
  `);

  // Publish / anyone-with-the-link — public_id mirrors note id when live.
  await pool.query(`
    ALTER TABLE notes
      ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;
  `);
  await pool.query(`
    ALTER TABLE notes
      ADD COLUMN IF NOT EXISTS public_id TEXT;
  `);
  await pool.query(`
    ALTER TABLE notes
      ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS notes_public_id_uidx
    ON notes (public_id)
    WHERE public_id IS NOT NULL;
  `);
  await pool.query(`
    ALTER TABLE notes
      ADD COLUMN IF NOT EXISTS author_handle TEXT;
  `);

  // Soft-delete / Archived (Recently Deleted).
  await pool.query(`
    ALTER TABLE notes
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS notes_user_live_updated_at_idx
    ON notes (user_id, updated_at DESC)
    WHERE deleted_at IS NULL;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS notes_user_deleted_at_idx
    ON notes (user_id, deleted_at DESC)
    WHERE deleted_at IS NOT NULL;
  `);

  // True sub-notes: a note created from INSIDE another note is owned by it.
  // Peer hyperlinks in a body never create this edge (see #77 / #79 / #80).
  // SET NULL, not CASCADE: deleting a parent promotes its children to root
  // rather than silently taking a subtree the user never selected.
  await pool.query(`
    ALTER TABLE notes
      ADD COLUMN IF NOT EXISTS parent_id TEXT
      REFERENCES notes(id) ON UPDATE CASCADE ON DELETE SET NULL;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS notes_user_parent_idx
    ON notes (user_id, parent_id);
  `);

  // Body revision trail — previous body before overwrite (see README recovery).
  // ON DELETE CASCADE: permanent delete / archive purge also drops revisions.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS note_revisions (
      id BIGSERIAL PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES notes(id) ON UPDATE CASCADE ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS note_revisions_note_created_idx
    ON note_revisions (note_id, created_at DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS note_revisions_created_at_idx
    ON note_revisions (created_at);
  `);

  // CRDT note body (see lib/crdt/*). Append-only Yjs update log: rows are
  // never UPDATEd, only INSERTed and dropped once folded into a snapshot.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS note_doc_updates (
      seq BIGSERIAL PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES notes(id) ON UPDATE CASCADE ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      update_bin BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS note_doc_updates_note_seq_idx
    ON note_doc_updates (note_id, seq);
  `);
  // Compacted state, one row per CRDT-backed note. Its presence is also the
  // marker that the note's body is CRDT-managed (legacy PUT must 409).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS note_doc_snapshots (
      note_id TEXT PRIMARY KEY REFERENCES notes(id) ON UPDATE CASCADE ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      state_bin BYTEA NOT NULL,
      state_vector BYTEA NOT NULL,
      through_seq BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await migrateLegacyNoteIds(pool);
}

export async function ensureSchema() {
  if (!global.__agentnoteSchemaReady) {
    global.__agentnoteSchemaReady = (async () => {
      await runSchemaMigrations(getPool());
    })().catch((error) => {
      // Sticky rejected promise would pin warm serverless isolates to the
      // outage forever (e.g. Railway restart → digest 2206690639 on every hit).
      global.__agentnoteSchemaReady = undefined;
      if (isTransientDbError(error)) {
        resetPool();
      }
      throw error;
    });
  }
  await global.__agentnoteSchemaReady;
}

export async function query<T extends QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  try {
    await ensureSchema();
    return await getPool().query<T>(text, params);
  } catch (error) {
    if (!isTransientDbError(error)) throw error;
    resetPool();
    await ensureSchema();
    return getPool().query<T>(text, params);
  }
}
