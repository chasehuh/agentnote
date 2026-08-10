export function PoweredBySume({ className }: { className?: string }) {
  return (
    <p className={["sume-powered", className].filter(Boolean).join(" ")}>
      Powered by{" "}
      <a
        href="https://sume.com"
        target="_blank"
        rel="noopener noreferrer"
        className="sume-powered__link"
      >
        sume.com
      </a>
    </p>
  );
}
