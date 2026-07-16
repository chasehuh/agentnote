/** Minimal first paint while `/` resolves auth + notes (avoids a blank shell). */
export default function Loading() {
  return (
    <main className="zed-login" aria-busy="true">
      <div className="zed-dialog">
        <h1 className="zed-dialog__title">agentnote</h1>
        <p className="zed-dialog__desc">Loading…</p>
      </div>
    </main>
  );
}
