import React from 'react';
import { Menu, Bell, Volume2, ShieldCheck } from 'lucide-react';
import { NavItemKey } from './Sidebar';

interface TopbarProps {
  activeView: NavItemKey;
  onOpenMobileSidebar: () => void;
  isAcceptingOrders: boolean;
  onToggleAcceptingOrders: (accepted: boolean) => void;
  waitingChatsCount?: number;
}

export const Topbar: React.FC<TopbarProps> = ({
  activeView,
  onOpenMobileSidebar,
  isAcceptingOrders,
  onToggleAcceptingOrders,
  waitingChatsCount = 1,
}) => {
  const titles: Record<NavItemKey, { title: string; subtitle: string }> = {
    dashboard: { title: 'Dashboard Operativo', subtitle: 'Vista en tiempo real del servicio' },
    orders: { title: 'Gestión de Pedidos', subtitle: 'Flujo de cocina y despacho de pedidos WhatsApp' },
    conversations: { title: 'Bandeja de Conversaciones', subtitle: 'Supervisión en vivo de WhatsApp & Handoff Humano' },
    menu: { title: 'Catálogo de Menú & Stock', subtitle: 'Control de precios y activación rápida de disponibilidad' },
    customers: { title: 'Directorio de Clientes', subtitle: 'Historial y recurrencia de compradores por WhatsApp' },
    metrics: { title: 'Métricas & Reportes', subtitle: 'Análisis de ventas, tiempos y desempeño del agente IA' },
    settings: { title: 'Configuración del Sistema', subtitle: 'Parámetros del agente IA, horarios y reglas de negocio' },
  };

  const current = titles[activeView] || { title: 'Panel Administrativo', subtitle: '' };

  return (
    <header className="h-16 bg-white border-b border-slate-200 sticky top-0 z-20 px-4 sm:px-6 flex items-center justify-between shadow-2xs">
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobileSidebar}
          className="md:hidden p-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100"
          aria-label="Abrir menú"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">{current.title}</h2>
          <p className="hidden sm:block text-xs text-slate-500">{current.subtitle}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        {/* Store Open/Emergency Pause Switch */}
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              isAcceptingOrders ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
            }`}
          />
          <span className="hidden sm:inline text-slate-700">
            {isAcceptingOrders ? 'Local Abierto' : 'Recepción Pausada'}
          </span>
          <button
            onClick={() => onToggleAcceptingOrders(!isAcceptingOrders)}
            className="text-[11px] underline text-slate-500 hover:text-slate-800 ml-1 font-medium"
          >
            {isAcceptingOrders ? 'Pausar' : 'Reanudar'}
          </button>
        </div>

        {/* Audio notification indicator */}
        <button
          className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors hidden sm:flex items-center justify-center"
          title="Alertas de audio para nuevos pedidos y traspasos activas"
          aria-label="Audio de alertas activo"
        >
          <Volume2 className="w-4 h-4 text-emerald-600" />
        </button>

        {/* Urgent Alerts Bell */}
        <div className="relative">
          <button
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors relative"
            aria-label="Ver alertas"
          >
            <Bell className="w-4 h-4" />
            {waitingChatsCount > 0 && (
              <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-rose-600 ring-2 ring-white animate-pulse" />
            )}
          </button>
        </div>

        {/* User Badge */}
        <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
          <div className="w-8 h-8 rounded-full bg-orange-100 border border-orange-200 flex items-center justify-center text-xs font-bold text-orange-700">
            AD
          </div>
          <div className="hidden lg:block text-left text-xs leading-none">
            <p className="font-semibold text-slate-800">Admin General</p>
            <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-600" />
              Propietario
            </p>
          </div>
        </div>
      </div>
    </header>
  );
};
