type LoadingSpinnerProps = {
  variant?: "page" | "overlay" | "inline";
};

export function LoadingSpinner({ variant = "page" }: LoadingSpinnerProps) {
  const wrapperClass =
    variant === "overlay"
      ? "fixed inset-0 z-20 flex items-center justify-center bg-hn-cream/40 backdrop-blur-[1px] pointer-events-none"
      : variant === "inline"
        ? "flex items-center justify-center py-3"
        : "flex min-h-[45vh] items-center justify-center";

  return (
    <div className={wrapperClass} aria-live="polite" aria-label="Loading">
      <div className="h-9 w-9 animate-spin rounded-full border-4 border-hn-orange/25 border-t-hn-orange" />
    </div>
  );
}
