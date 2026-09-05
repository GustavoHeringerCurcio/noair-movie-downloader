import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  hint?: string;
  steps?: string[];
  icon?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}

export function EmptyState({ title, hint, steps, icon, actionLabel, onAction, compact }: EmptyStateProps) {
  const rootClass = compact ? 'empty-state-card empty-state-card--compact' : 'empty-state-card';
  return (
    <div className={rootClass}>
      <div className="es-main">
        {icon && <div className="empty-state-icon">{icon}</div>}
        <div className="es-text">
          <h3>{title}</h3>
          {hint && <p>{hint}</p>}
        </div>
      </div>
      <div className="es-side">
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
          <button type="button" className="btn btn-white" onClick={onAction}>
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
