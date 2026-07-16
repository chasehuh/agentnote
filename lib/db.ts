import { Pool, type QueryResultRow } from "pg";
import { createNoteId, isCanonicalNoteId } from "./note-id";

declare global {
  // eslint-disable-next-line no-var
  var __agentnotePool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __agentnoteSchemaReady: Promise<void> | undefined;
}

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  return new Pool({
    connectionString,
    ssl: connectionString.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
    max: 5,
  });
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

export async function ensureSchema() {
  if (!global.__agentnoteSchemaReady) {
    global.__agentnoteSchemaReady = (async () => {
      const pool = getPool();
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

      // Publish / anyone-with-the-link share (separate opaque public_id).
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

      await migrateLegacyNoteIds(pool);
    })();
  }
  await global.__agentnoteSchemaReady;
}

export async function query<T extends QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  await ensureSchema();
  return getPool().query<T>(text, params);
}
