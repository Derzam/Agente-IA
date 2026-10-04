import React, { useState, useEffect } from 'react';
import { AlertCircle, RefreshCw, WifiOff, ShieldAlert, ServerCrash, Gauge, ZapOff } from 'lucide-react';
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
  let code: string | undefined;
  let retryAfterSec: number | undefined;
  let icon = <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" aria-hidden="true" />;
  let bannerColor = 'bg-rose-50 border-rose-200 text-rose-900';

  if (error instanceof NetworkError) {
    title = 'Sin conexión de red';
    message = 'Verifica tu conexión a internet o el estado del servidor.';
    icon = <WifiOff className="w-5 h-5 text-amber-600 shrink-0" aria-hidden="true" />;
    bannerColor = 'bg-amber-50 border-amber-200 text-amber-900';
  } else if (error instanceof TimeoutError) {
    title = 'Tiempo de espera agotado';
    message = error.message;
    bannerColor = 'bg-amber-50 border-amber-200 text-amber-900';
  } else if (error instanceof AuthError) {
    title = 'Sesión no autorizada';
    message = error.message;
    icon = <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" aria-hidden="true" />;
  } else if (error instanceof NormalizedApiError) {
    requestId = error.requestId;
    code = error.code;
    retryAfterSec = error.retryAfterSeconds;

    if (error.status === 403) {
      title = 'Permisos insuficientes';
      message = 'No tienes permisos para realizar esta operación en este negocio.';
      icon = <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" aria-hidden="true" />;
    } else if (error.status === 404) {
      title = 'Recurso no encontrado';
      message = 'El registro solicitado no existe o no está accesible.';
    } else if (error.status === 429) {
      title = 'Límite de solicitudes alcanzado';
      message = error.message;
      icon = <Gauge className="w-5 h-5 text-orange-600 shrink-0" aria-hidden="true" />;
      bannerColor = 'bg-orange-50 border-orange-200 text-orange-950';
    } else if (error.status === 503 || error.code === 'PROVIDER_UNAVAILABLE') {
      title = 'Proveedor temporalmente no disponible';
      message = error.message || 'El servicio o sus dependencias están temporalmente fuera de línea. Tu sesión sigue activa.';
      icon = <ServerCrash className="w-5 h-5 text-amber-600 shrink-0" aria-hidden="true" />;
      bannerColor = 'bg-amber-50 border-amber-300 text-amber-950';
    } else if (error.code === 'CIRCUIT_OPEN' as any) {
      title = 'Servicio de IA temporalmente suspendido';
      message = error.message || 'El circuito de protección del proveedor está abierto. No se realizarán reintentos continuos.';
      icon = <ZapOff className="w-5 h-5 text-purple-600 shrink-0" aria-hidden="true" />;
      bannerColor = 'bg-purple-50 border-purple-300 text-purple-950';
    } else {
      message = error.message;
    }
  } else if (error instanceof Error) {
    message = error.message;
  }

  // Rate limit countdown to prevent retry loops
  const [countdown, setCountdown] = useState<number>(retryAfterSec || 0);

  useEffect(() => {
    setCountdown(retryAfterSec || 0);
  }, [retryAfterSec]);

  useEffect(() => {
    if (countdown <= 0) return;
    const interval = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [countdown]);

  return (
    <div
      role="alert"
      className={`p-4 border rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${bannerColor} ${className}`}
    >
      <div className="flex items-start gap-3">
        {icon}
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs sm:text-sm font-semibold">{title}</p>
            {code && (
              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-white/70 border border-current opacity-75">
                {code}
              </span>
            )}
          </div>
          <p className="text-xs opacity-90 mt-0.5">{message}</p>
          {countdown > 0 && (
            <p className="text-[11px] font-mono mt-1 opacity-80">
              Espera requerida: {countdown}s para reintentar
            </p>
          )}
          {requestId && (
            <p className="text-[10px] font-mono mt-1 opacity-70">
              ID de soporte: {requestId}
            </p>
          )}
        </div>
      </div>
      {onRetry && (
        <Button
          variant="outline"
          size="sm"
          disabled={countdown > 0}
          onClick={onRetry}
          leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
          className="shrink-0 bg-white hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400"
        >
          {countdown > 0 ? `Espera ${countdown}s` : 'Reintentar'}
        </Button>
      )}
    </div>
  );
};
