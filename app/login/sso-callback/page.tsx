import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

export default function LoginSsoCallbackPage() {
  return (
    <main className="zed-login">
      <div className="zed-dialog">
        <h1 className="zed-dialog__title">agentnote</h1>
        <p className="zed-dialog__desc">Finishing GitHub sign-in…</p>
        <AuthenticateWithRedirectCallback
          signInFallbackRedirectUrl="/"
          signUpFallbackRedirectUrl="/"
        />
      </div>
    </main>
  );
}
