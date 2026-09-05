import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  hint?: string;
  steps?: string[];
  icon?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ title, hint, steps, icon, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="empty-state-card">
      {icon && <div className="empty-state-icon">{icon}</div>}
      <h3>{title}</h3>
      {hint && <p>{hint}</p>}
      {steps && steps.length > 0 && (
        <div className="guide-steps">
          {steps.map((step) => (
            <span key={step} className="guide-step">
              {step}
            </span>
          ))}
        </div>
      )}
      {actionLabel && onAction && (
        <div className="empty-actions">
          <button type="button" className="btn btn-white" onClick={onAction}>
            {actionLabel}
          </button>
        </div>
      )}
    </div>
  );
}
