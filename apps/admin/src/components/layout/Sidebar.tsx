import React from 'react';
import {
  LayoutDashboard,
  UtensilsCrossed,
  MessageSquareText,
  BookOpen,
  Users,
  Settings,
  BarChart3,
  X,
  Bot,
  Store,
} from 'lucide-react';

export type NavItemKey =
  | 'dashboard'
  | 'orders'
  | 'conversations'
  | 'menu'
  | 'customers'
  | 'metrics'
  | 'settings';

interface SidebarProps {
  activeView: NavItemKey;
  onNavigate: (view: NavItemKey) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  pendingOrdersCount?: number;
  waitingChatsCount?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeView,
  onNavigate,
  isOpenMobile,
  onCloseMobile,
  pendingOrdersCount = 1,
  waitingChatsCount = 1,
}) => {
  const navItems = [
    { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { key: 'orders', label: 'Pedidos', icon: UtensilsCrossed, badge: pendingOrdersCount, badgeColor: 'bg-amber-500' },
    { key: 'conversations', label: 'Conversaciones', icon: MessageSquareText, badge: waitingChatsCount, badgeColor: 'bg-rose-500' },
    { key: 'menu', label: 'Menú & Stock', icon: BookOpen },
    { key: 'customers', label: 'Clientes', icon: Users },
    { key: 'metrics', label: 'Métricas', icon: BarChart3 },
    { key: 'settings', label: 'Configuración', icon: Settings },
  ];

  const sidebarContent = (
    <div className="flex flex-col h-full bg-slate-900 text-slate-100">
      {/* Brand Header */}
      <div className="p-5 border-b border-slate-800/80 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-600 flex items-center justify-center text-white shadow-md shadow-orange-950/40">
            <Store className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-sm tracking-tight text-white flex items-center gap-1.5">
              Burger Station
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30">
                PRO
              </span>
            </h1>
            <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
              <Bot className="w-3 h-3 text-emerald-400" />
              <span>Agente WhatsApp Activo</span>
            </p>
          </div>
        </div>
        <button
          onClick={onCloseMobile}
          className="md:hidden p-1.5 text-slate-400 hover:text-white rounded-lg"
          aria-label="Cerrar navegación"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Nav Links */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.key;
          return (
            <button
              key={item.key}
              onClick={() => {
                onNavigate(item.key as NavItemKey);
                onCloseMobile();
              }}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                isActive
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </div>
              {item.badge !== undefined && item.badge > 0 && (
                <span
                  className={`text-[11px] font-bold px-2 py-0.5 rounded-full text-white ${
                    isActive ? 'bg-orange-700/80' : item.badgeColor
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer System Status */}
      <div className="p-4 border-t border-slate-800/80 bg-slate-950/40 text-xs">
        <div className="flex items-center justify-between text-slate-400 mb-2">
          <span>Meta Cloud API</span>
          <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Conectado
          </span>
        </div>
        <p className="text-[11px] text-slate-500 truncate">
          Fase 1: UX & Mock Engine
        </p>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Fixed Sidebar */}
      <aside className="hidden md:block w-64 h-screen fixed left-0 top-0 z-30 shrink-0">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {isOpenMobile && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity"
            onClick={onCloseMobile}
          />
          <div className="relative w-72 max-w-full h-full shadow-2xl z-10 animate-slideRight">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
};
