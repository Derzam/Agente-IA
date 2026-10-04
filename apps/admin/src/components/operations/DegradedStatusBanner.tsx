import React from 'react';
import { AlertTriangle, Info } from 'lucide-react';

interface DegradedStatusBannerProps {
  title?: string;
  message: string;
  advice?: string;
  variant?: 'warning' | 'info';
  className?: string;
}

export const DegradedStatusBanner: React.FC<DegradedStatusBannerProps> = ({
  title = 'Servicio en modo degradado',
  message,
  advice,
  variant = 'warning',
  className = '',
}) => {
  const isWarning = variant === 'warning';

  return (
    <aside
      role="status"
      aria-live="polite"
      className={`p-4 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs sm:text-sm ${
        isWarning
          ? 'bg-amber-50 border-amber-300 text-amber-900'
          : 'bg-sky-50 border-sky-300 text-sky-900'
      } ${className}`}
    >
      <div className="flex items-start gap-3">
        {isWarning ? (
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
        ) : (
          <Info className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" aria-hidden="true" />
        )}
        <div>
          <h4 className="font-bold text-xs sm:text-sm">{title}</h4>
          <p className="text-xs mt-0.5 opacity-90">{message}</p>
          {advice && (
            <p className="text-[11px] font-medium mt-1 underline decoration-dotted">
              {advice}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
};
