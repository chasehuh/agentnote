import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

export default function LoginSsoCallbackPage() {
  return (
    <main className="zed-login">
      <div className="zed-dialog">
        <p className="zed-dialog__desc">Finishing GitHub sign-in…</p>
        <AuthenticateWithRedirectCallback />
      </div>
    </main>
  );
}
