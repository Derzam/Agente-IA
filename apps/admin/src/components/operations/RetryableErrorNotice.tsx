import React from 'react';
import { ServerCrash, RefreshCw } from 'lucide-react';
import { Button } from '@/components/common/Button';

interface RetryableErrorNoticeProps {
  code?: string;
  message?: string;
  requestId?: string;
  onRetry?: () => void;
  className?: string;
}

export const RetryableErrorNotice: React.FC<RetryableErrorNoticeProps> = ({
  code,
  message,
  requestId,
  onRetry,
  className = '',
}) => {
  const displayTitle = code === 'PROVIDER_UNAVAILABLE'
    ? 'Proveedor temporalmente no disponible'
    : 'Servicio no disponible temporalmente';

  const defaultMsg =
    'El backend o uno de sus servicios upstream (OpenAI, Meta o base de datos) está experimentando demoras o una interrupción momentánea. Tu sesión sigue activa.';

  return (
    <div
      role="alert"
      className={`p-4 bg-amber-50 border border-amber-300 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-amber-950 ${className}`}
    >
      <div className="flex items-start gap-3">
        <ServerCrash className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <h4 className="font-bold text-xs sm:text-sm">{displayTitle}</h4>
            {code && (
              <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-amber-200 text-amber-900 rounded">
                {code}
              </span>
            )}
          </div>
          <p className="text-xs text-amber-800">{message || defaultMsg}</p>
          {requestId && (
            <p className="text-[10px] text-amber-700 font-mono">
              ID de solicitud: {requestId}
            </p>
          )}
        </div>
      </div>

      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          className="shrink-0 bg-white border-amber-300 text-amber-900 hover:bg-amber-100"
        >
          Reintentar
        </Button>
      )}
    </div>
  );
};
