export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      {label ? <span className="spinner-label">{label}</span> : null}
    </div>
  );
}
