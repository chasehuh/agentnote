"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        setError("Wrong password");
        setLoading(false);
        return;
      }

      router.replace("/");
      router.refresh();
    } catch {
      setError("Could not sign in");
      setLoading(false);
    }
  }

  return (
    <main className="zed-login">
      <form className="zed-dialog" onSubmit={onSubmit} autoComplete="current-password">
        <h1 className="zed-dialog__title">memo</h1>
        <p className="zed-dialog__desc">Enter the password to unlock.</p>
        <label className="sr-only" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          className="zed-field"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          autoFocus
        />
        <div className="zed-dialog__row">
          <p className="zed-dialog__error">{error}</p>
          <button
            type="submit"
            className="zed-btn zed-btn-primary"
            disabled={loading || !password}
          >
            {loading ? "…" : "Unlock"}
          </button>
        </div>
      </form>
    </main>
  );
}
