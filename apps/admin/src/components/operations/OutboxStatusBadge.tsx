import React from 'react';
import {
  Clock,
  Loader2,
  Check,
  CheckCheck,
  XCircle,
  HelpCircle,
  AlertOctagon,
} from 'lucide-react';
import type { DeliveryStatus } from '@/types/viewModels';

interface OutboxStatusBadgeProps {
  status: DeliveryStatus | null | undefined;
  failureCode?: string | null;
  compact?: boolean;
  className?: string;
}

export const OutboxStatusBadge: React.FC<OutboxStatusBadgeProps> = ({
  status,
  failureCode,
  compact = false,
  className = '',
}) => {
  if (!status) return null;

  switch (status) {
    case 'queued':
      if (compact) {
        return (
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-mono text-slate-500 ${className}`}
            title="Encolado en cola de salida"
            aria-label="Mensaje encolado"
          >
            <Clock className="w-3 h-3 text-slate-400" aria-hidden="true" />
            <span className="sr-only">Encolado</span>
          </span>
        );
      }
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200 ${className}`}
          role="status"
        >
          <Clock className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
          <span>Encolado</span>
        </span>
      );

    case 'pending':
      if (compact) {
        return (
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-mono text-slate-500 ${className}`}
            title="Pendiente de procesamiento"
            aria-label="Mensaje pendiente"
          >
            <Clock className="w-3 h-3 text-amber-500" aria-hidden="true" />
            <span className="sr-only">Pendiente</span>
          </span>
        );
      }
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 ${className}`}
          role="status"
        >
          <Clock className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
          <span>Pendiente</span>
        </span>
      );

    case 'sending':
      if (compact) {
        return (
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-mono text-sky-500 ${className}`}
            title="Enviando al proveedor"
            aria-label="Enviando mensaje"
          >
            <Loader2 className="w-3 h-3 text-sky-500 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <span className="sr-only">Enviando</span>
          </span>
        );
      }
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-sky-50 text-sky-800 border border-sky-200 ${className}`}
          role="status"
        >
          <Loader2 className="w-3.5 h-3.5 text-sky-600 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <span>Enviando</span>
        </span>
      );

    case 'sent':
      if (compact) {
        return (
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-mono text-slate-600 ${className}`}
            title="Enviado al proveedor"
            aria-label="Enviado al proveedor"
          >
            <Check className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
            <span className="sr-only">Enviado al proveedor</span>
          </span>
        );
      }
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800 border border-slate-200 ${className}`}
          role="status"
        >
          <Check className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
          <span>Enviado al proveedor</span>
        </span>
      );

    case 'delivered':
      if (compact) {
        return (
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-mono text-emerald-600 ${className}`}
            title="Entregado al destinatario"
            aria-label="Mensaje entregado"
          >
            <CheckCheck className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
            <span className="sr-only">Entregado</span>
          </span>
        );
      }
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 ${className}`}
          role="status"
        >
          <CheckCheck className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
          <span>Entregado</span>
        </span>
      );

    case 'read':
      if (compact) {
        return (
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-mono text-sky-600 ${className}`}
            title="Leído por el destinatario"
            aria-label="Mensaje leído"
          >
            <CheckCheck className="w-3.5 h-3.5 text-sky-500 font-bold" aria-hidden="true" />
            <span className="sr-only">Leído</span>
          </span>
        );
      }
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-sky-50 text-sky-900 border border-sky-300 ${className}`}
          role="status"
        >
          <CheckCheck className="w-3.5 h-3.5 text-sky-600 font-bold" aria-hidden="true" />
          <span>Leído</span>
        </span>
      );

    case 'failed': {
      const label = failureCode ? `Falló el envío (${failureCode})` : 'Falló el envío';
      if (compact) {
        return (
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-mono text-rose-600 ${className}`}
            title={label}
            aria-label={label}
          >
            <XCircle className="w-3.5 h-3.5 text-rose-500" aria-hidden="true" />
            {failureCode && <span className="text-[10px] font-bold text-rose-700">{failureCode}</span>}
            <span className="sr-only">{label}</span>
          </span>
        );
      }
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-800 border border-rose-200 ${className}`}
          role="status"
        >
          <XCircle className="w-3.5 h-3.5 text-rose-600" aria-hidden="true" />
          <span>{label}</span>
        </span>
      );
    }

    case 'unknown':
      if (compact) {
        return (
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-mono text-amber-600 ${className}`}
            title="Estado por confirmar"
            aria-label="Estado por confirmar"
          >
            <HelpCircle className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
            <span className="sr-only">Estado por confirmar</span>
          </span>
        );
      }
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-900 border border-amber-300 ${className}`}
          role="status"
        >
          <HelpCircle className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
          <span>Estado por confirmar</span>
        </span>
      );

    case 'dead_letter':
      if (compact) {
        return (
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-mono text-rose-700 ${className}`}
            title="Requiere revisión (agotados reintentos)"
            aria-label="Requiere revisión"
          >
            <AlertOctagon className="w-3.5 h-3.5 text-rose-600" aria-hidden="true" />
            <span className="sr-only">Requiere revisión</span>
          </span>
        );
      }
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-900 border border-rose-300 ${className}`}
          role="status"
        >
          <AlertOctagon className="w-3.5 h-3.5 text-rose-700" aria-hidden="true" />
          <span>Requiere revisión</span>
        </span>
      );

    default:
      return null;
  }
};
