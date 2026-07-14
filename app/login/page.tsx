import { GitHubSignInButton } from "@/components/github-sign-in-button";

export default function LoginPage() {
  return (
    <main className="zed-login">
      <div className="zed-dialog">
        <h1 className="zed-dialog__title">memo</h1>
        <p className="zed-dialog__desc">
          Sign in with GitHub to unlock your notes.
        </p>
        <GitHubSignInButton />
      </div>
    </main>
  );
}
