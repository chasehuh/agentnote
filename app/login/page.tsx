import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { GitHubSignInButton } from "@/components/github-sign-in-button";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const { userId } = await auth();
  // Defense in depth: proxy already bounces signed-in users off /login.
  if (userId) {
    redirect("/");
  }

  return (
    <main className="zed-login">
      <div className="zed-dialog">
        <h1 className="zed-dialog__title">agentnote</h1>
        <p className="zed-dialog__desc">
          Sign in with GitHub to unlock your notes.
        </p>
        <GitHubSignInButton />
      </div>
    </main>
  );
}
