import React from 'react';
import { AlertCircle, RefreshCw, WifiOff, ShieldAlert } from 'lucide-react';
import { NormalizedApiError, NetworkError, TimeoutError, AuthError } from '@/api/types';
import { Button } from './Button';

interface ApiErrorBannerProps {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

export const ApiErrorBanner: React.FC<ApiErrorBannerProps> = ({ error, onRetry, className = '' }) => {
  if (!error) return null;

  let title = 'Ocurrió un error';
  let message = 'No se pudo completar la solicitud.';
  let requestId: string | undefined;
  let icon = <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />;

  if (error instanceof NetworkError) {
    title = 'Sin conexión de red';
    message = 'Verifica tu conexión a internet o el estado del servidor.';
    icon = <WifiOff className="w-5 h-5 text-amber-600 shrink-0" />;
  } else if (error instanceof TimeoutError) {
    title = 'Tiempo de espera agotado';
    message = error.message;
  } else if (error instanceof AuthError) {
    title = 'Sesión no autorizada';
    message = error.message;
    icon = <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />;
  } else if (error instanceof NormalizedApiError) {
    requestId = error.requestId;
    if (error.status === 403) {
      title = 'Permisos insuficientes';
      message = 'No tienes permisos para realizar esta operación en este negocio.';
      icon = <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />;
    } else if (error.status === 404) {
      title = 'Recurso no encontrado';
      message = 'El registro solicitado no existe o no está accesible.';
    } else if (error.status === 429) {
      title = 'Límite de solicitudes superado';
      message = error.message;
    } else if (error.status === 503) {
      title = 'Servicio no disponible';
      message = 'El servicio o sus dependencias están temporalmente fuera de línea.';
    } else {
      message = error.message;
    }
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <div
      role="alert"
      className={`p-4 bg-rose-50 border border-rose-200 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-rose-900 ${className}`}
    >
      <div className="flex items-start gap-3">
        {icon}
        <div>
          <p className="text-xs sm:text-sm font-semibold">{title}</p>
          <p className="text-xs text-rose-700 mt-0.5">{message}</p>
          {requestId && (
            <p className="text-[10px] text-rose-500 font-mono mt-1">
              ID de soporte: {requestId}
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
          className="shrink-0 bg-white border-rose-300 text-rose-800 hover:bg-rose-100"
        >
          Reintentar
        </Button>
      )}
    </div>
  );
};
