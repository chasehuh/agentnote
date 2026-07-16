import Link from "next/link";

export default function PublicNoteNotFound() {
  return (
    <main className="zed-login">
      <div className="zed-dialog">
        <h1 className="zed-dialog__title">Link unavailable</h1>
        <p className="zed-dialog__desc">
          This note is private or the link was revoked.
        </p>
        <Link className="zed-link" href="/">
          Open agentnote
        </Link>
      </div>
    </main>
  );
}
