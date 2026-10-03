import React, { useState } from 'react';
import {
  Menu,
  Bell,
  Volume2,
  ShieldCheck,
  Building2,
  ChevronDown,
  LogOut,
  Sparkles,
} from 'lucide-react';
import { NavItemKey } from './Sidebar';
import { useSession } from '@/auth/SessionContext';
import { useBusiness } from '@/auth/BusinessContext';

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
  const { user, signOut, isMockMode } = useSession();
  const { activeBusiness, activeBusinessId, activeRole, memberships, selectBusiness } = useBusiness();
  const [isBusinessMenuOpen, setIsBusinessMenuOpen] = useState(false);

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

  const roleLabels: Record<string, string> = {
    owner: 'Propietario',
    manager: 'Gerente',
    operator: 'Operador',
  };

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
          <div className="flex items-center gap-2">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
              {current.title}
            </h2>
            {isMockMode ? (
              <span className="hidden sm:inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800 border border-amber-200">
                <Sparkles className="w-3 h-3 text-amber-600" />
                Modo Mock
              </span>
            ) : (
              <span className="hidden sm:inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                API Real
              </span>
            )}
          </div>
          <p className="hidden sm:block text-xs text-slate-500">{current.subtitle}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        {/* Business Selector */}
        <div className="relative">
          <button
            onClick={() => setIsBusinessMenuOpen((prev) => !prev)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-medium text-slate-700 transition-colors"
            aria-label="Seleccionar negocio"
            title="Negocio activo"
          >
            <Building2 className="w-3.5 h-3.5 text-slate-500" />
            <span className="max-w-[120px] sm:max-w-[160px] truncate font-semibold">
              {activeBusiness?.name || 'Cargando negocio...'}
            </span>
            {memberships.length > 1 && <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
          </button>

          {isBusinessMenuOpen && memberships.length > 1 && (
            <div className="absolute right-0 mt-1 w-64 bg-white rounded-xl shadow-lg border border-slate-200 py-1.5 z-30 animate-fadeIn">
              <div className="px-3 py-1 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                Negocios autorizados
              </div>
              {memberships.map((m) => (
                <button
                  key={m.business_id}
                  onClick={() => {
                    selectBusiness(m.business_id);
                    setIsBusinessMenuOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between hover:bg-slate-50 transition-colors ${
                    m.business_id === activeBusinessId
                      ? 'bg-orange-50 font-bold text-orange-900'
                      : 'text-slate-700'
                  }`}
                >
                  <span className="truncate">
                    {m.business_id === activeBusinessId ? activeBusiness?.name || m.business_id : m.business_id}
                  </span>
                  <span className="text-[10px] text-slate-400 capitalize">{m.role}</span>
                </button>
              ))}
            </div>
          )}
        </div>

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

        {/* User Badge & Logout */}
        <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
          <div className="w-8 h-8 rounded-full bg-orange-100 border border-orange-200 flex items-center justify-center text-xs font-bold text-orange-700">
            {user?.email ? user.email.slice(0, 2).toUpperCase() : 'AD'}
          </div>
          <div className="hidden lg:block text-left text-xs leading-none">
            <p className="font-semibold text-slate-800">
              {user?.user_metadata?.name || user?.email || 'Usuario'}
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-emerald-600" />
              {activeRole ? roleLabels[activeRole] || activeRole : 'Operador'}
            </p>
          </div>
          <button
            onClick={() => signOut()}
            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
