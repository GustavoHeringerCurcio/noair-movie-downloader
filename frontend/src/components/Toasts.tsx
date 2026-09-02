import { useToastStore } from '../store/toastStore';

export function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`toast toast-${t.kind}`}
          onClick={() => dismiss(t.id)}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
