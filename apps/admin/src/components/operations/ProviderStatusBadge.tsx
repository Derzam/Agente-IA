import React from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Settings,
  MinusCircle,
  ZapOff,
  Gauge,
  Coins,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
/**
 * Presentation-only labels for future provider status UI.
 * These values are not an API/shared contract and must not be populated
 * in real mode until the backend publishes an authoritative status.
 */
export type LocalProviderBadgeStatus =
  | 'configured'
  | 'not_configured'
  | 'degraded'
  | 'available'
  | 'unavailable'
  | 'circuit_open'
  | 'rate_limited'
  | 'budget_exceeded'
  | 'enabled'
  | 'disabled';

interface ProviderStatusBadgeProps {
  status: LocalProviderBadgeStatus;
  size?: 'sm' | 'md';
  className?: string;
}

export const ProviderStatusBadge: React.FC<ProviderStatusBadgeProps> = ({
  status,
  size = 'md',
  className = '',
}) => {
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs';
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';

  switch (status) {
    case 'available':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 ${sizeClasses} ${className}`}
          role="status"
          aria-label="Proveedor disponible"
        >
          <CheckCircle2 className={`${iconSize} text-emerald-600`} aria-hidden="true" />
          <span>Disponible</span>
        </span>
      );

    case 'degraded':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full font-medium bg-amber-50 text-amber-800 border border-amber-300 ${sizeClasses} ${className}`}
          role="status"
          aria-label="Proveedor en modo degradado"
        >
          <AlertTriangle className={`${iconSize} text-amber-600`} aria-hidden="true" />
          <span>Degradado</span>
        </span>
      );

    case 'unavailable':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full font-medium bg-rose-50 text-rose-800 border border-rose-200 ${sizeClasses} ${className}`}
          role="status"
          aria-label="Proveedor no disponible"
        >
          <XCircle className={`${iconSize} text-rose-600`} aria-hidden="true" />
          <span>No disponible</span>
        </span>
      );

    case 'configured':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full font-medium bg-sky-50 text-sky-800 border border-sky-200 ${sizeClasses} ${className}`}
          role="status"
          aria-label="Canal configurado"
        >
          <Settings className={`${iconSize} text-sky-600`} aria-hidden="true" />
          <span>Configurado</span>
        </span>
      );

    case 'not_configured':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full font-medium bg-slate-100 text-slate-700 border border-slate-200 ${sizeClasses} ${className}`}
          role="status"
          aria-label="Canal no configurado"
        >
          <MinusCircle className={`${iconSize} text-slate-500`} aria-hidden="true" />
          <span>No configurado</span>
        </span>
      );

    case 'circuit_open':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full font-bold bg-purple-50 text-purple-900 border border-purple-300 ${sizeClasses} ${className}`}
          role="status"
          aria-label="Circuito abierto de IA suspendido"
        >
          <ZapOff className={`${iconSize} text-purple-600`} aria-hidden="true" />
          <span>Circuito Abierto</span>
        </span>
      );

    case 'rate_limited':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full font-medium bg-orange-50 text-orange-900 border border-orange-300 ${sizeClasses} ${className}`}
          role="status"
          aria-label="Límite de tasa alcanzado en el proveedor"
        >
          <Gauge className={`${iconSize} text-orange-600`} aria-hidden="true" />
          <span>Límite de tasa</span>
        </span>
      );

    case 'budget_exceeded':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full font-medium bg-rose-100 text-rose-900 border border-rose-300 ${sizeClasses} ${className}`}
          role="status"
          aria-label="Presupuesto de tokens o llamadas excedido"
        >
          <Coins className={`${iconSize} text-rose-700`} aria-hidden="true" />
          <span>Presupuesto Excedido</span>
        </span>
      );

    case 'enabled':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 ${sizeClasses} ${className}`}
          role="status"
          aria-label="Habilitado"
        >
          <ShieldCheck className={`${iconSize} text-emerald-600`} aria-hidden="true" />
          <span>Habilitado</span>
        </span>
      );

    case 'disabled':
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full font-medium bg-slate-100 text-slate-600 border border-slate-200 ${sizeClasses} ${className}`}
          role="status"
          aria-label="Deshabilitado"
        >
          <ShieldAlert className={`${iconSize} text-slate-500`} aria-hidden="true" />
          <span>Deshabilitado</span>
        </span>
      );

    default:
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full font-medium bg-slate-100 text-slate-700 border border-slate-200 ${sizeClasses} ${className}`}
          role="status"
        >
          <span>{String(status)}</span>
        </span>
      );
  }
};
