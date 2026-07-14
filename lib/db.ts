import { Pool, type QueryResultRow } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __memoPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __memoSchemaReady: Promise<void> | undefined;
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
  if (!global.__memoPool) {
    global.__memoPool = createPool();
  }
  return global.__memoPool;
}

export async function ensureSchema() {
  if (!global.__memoSchemaReady) {
    global.__memoSchemaReady = (async () => {
      const pool = getPool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS notes (
          id UUID PRIMARY KEY,
          title TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS notes_updated_at_idx
        ON notes (updated_at DESC);
      `);
    })();
  }
  await global.__memoSchemaReady;
}

export async function query<T extends QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  await ensureSchema();
  return getPool().query<T>(text, params);
}
