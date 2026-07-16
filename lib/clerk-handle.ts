import { currentUser } from "@clerk/nextjs/server";
import { normalizeAuthorHandle } from "./author-handle";

/** Prefer Clerk username, then linked GitHub username. */
export async function resolvePublisherHandle(): Promise<string | null> {
  const user = await currentUser();
  if (!user) return null;

  const fromUsername = normalizeAuthorHandle(user.username);
  if (fromUsername) return fromUsername;

  const github = user.externalAccounts.find(
    (account) =>
      account.provider === "oauth_github" || account.provider === "github",
  );
  return normalizeAuthorHandle(github?.username);
}
