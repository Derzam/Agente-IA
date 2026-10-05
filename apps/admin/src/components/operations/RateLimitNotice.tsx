import React, { useState, useEffect } from 'react';
import { Gauge, RefreshCw } from 'lucide-react';
import { Button } from '@/components/common/Button';

interface RateLimitNoticeProps {
  retryAfterSeconds?: number;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export const RateLimitNotice: React.FC<RateLimitNoticeProps> = ({
  retryAfterSeconds = 30,
  message,
  onRetry,
  className = '',
}) => {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(retryAfterSeconds);

  useEffect(() => {
    setSecondsRemaining(retryAfterSeconds);
  }, [retryAfterSeconds]);

  useEffect(() => {
    if (secondsRemaining <= 0) return;
    const interval = setInterval(() => {
      setSecondsRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [secondsRemaining]);

  const defaultMessage = secondsRemaining > 0
    ? `Límite de solicitudes alcanzado. Podrás reintentar en ${secondsRemaining} segundo${secondsRemaining === 1 ? '' : 's'}.`
    : 'Ya puedes reintentar tu solicitud.';

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`p-4 bg-orange-50 border border-orange-200 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-orange-950 ${className}`}
    >
      <div className="flex items-start gap-3">
        <Gauge className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <h4 className="font-bold text-xs sm:text-sm">Límite de frecuencia (Rate Limit)</h4>
          <p className="text-xs text-orange-800 mt-0.5">
            {message || defaultMessage}
          </p>
          {secondsRemaining > 0 && (
            <p className="text-[11px] text-orange-600 font-mono mt-1">
              Espera requerida por el backend: {secondsRemaining}s
            </p>
          )}
        </div>
      </div>

      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          disabled={secondsRemaining > 0}
          onClick={onRetry}
          leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${secondsRemaining > 0 ? '' : 'text-orange-600'}`} />}
          className="shrink-0 bg-white border-orange-300 text-orange-800 hover:bg-orange-100 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200"
        >
          {secondsRemaining > 0 ? `Espera ${secondsRemaining}s` : 'Reintentar'}
        </Button>
      )}
    </div>
  );
};
