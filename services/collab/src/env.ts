/** Required env, read once so a misconfigured deploy fails at boot, not mid-edit. */
export type CollabEnv = {
  port: number;
  clerkSecretKey: string;
  /**
   * Origins allowed to open a room. Empty means "any origin", which is only
   * safe because every connection still has to present a valid Clerk token for
   * a note the token's user owns.
   */
  allowedOrigins: string[];
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

export function readCollabEnv(): CollabEnv {
  // Railway injects PORT; default matches the Hocuspocus convention.
  const port = Number(process.env.PORT ?? 1234);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`PORT is not a valid port: ${process.env.PORT}`);
  }

  // DATABASE_URL is read by lib/db.ts, but fail here with a clear message.
  requireEnv("DATABASE_URL");

  return {
    port,
    clerkSecretKey: requireEnv("CLERK_SECRET_KEY"),
    allowedOrigins: (process.env.AGENTNOTE_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}
