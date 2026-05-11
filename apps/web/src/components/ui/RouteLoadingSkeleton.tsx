export function RouteLoadingSkeleton(): JSX.Element {
  return (
    <div className="min-h-screen bg-canvas text-text flex items-center justify-center">
      <div className="animate-pulse text-muted text-sm">Loading…</div>
    </div>
  );
}
