import React, { useState, useEffect } from 'react';
import { Sidebar, NavItemKey } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';
import { DashboardView } from '@/features/dashboard/DashboardView';
import { OrdersView } from '@/features/orders/OrdersView';
import { ConversationsView } from '@/features/conversations/ConversationsView';
import { MenuView } from '@/features/menu/MenuView';
import { CustomersView } from '@/features/customers/CustomersView';
import { SettingsView } from '@/features/settings/SettingsView';
import { MetricsView } from '@/features/metrics/MetricsView';
import { orderService } from '@/services/orderService';
import { conversationService } from '@/services/conversationService';
import { SessionProvider, useSession } from '@/auth/SessionContext';
import { BusinessProvider, useBusiness } from '@/auth/BusinessContext';
import { LoginView } from '@/auth/LoginView';
import { AlertCircle, LogOut } from 'lucide-react';
import { Button } from '@/components/common/Button';

const AdminLayout: React.FC = () => {
  const { isAuthenticated, isLoading: isAuthLoading, signOut } = useSession();
  const { isLoading: isBizLoading, error: bizError, refreshBusinessData } = useBusiness();

  const [activeView, setActiveView] = useState<NavItemKey>('dashboard');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isAcceptingOrders, setIsAcceptingOrders] = useState(true);
  const [selectedOrderId, setSelectedOrderId] = useState<string | undefined>();
  const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>();
  const [pendingOrdersCount, setPendingOrdersCount] = useState(1);
  const [waitingChatsCount, setWaitingChatsCount] = useState(1);

  useEffect(() => {
    if (isAuthenticated) {
      refreshCounters();
    }
  }, [activeView, isAuthenticated]);

  const refreshCounters = async () => {
    try {
      const [orders, convs] = await Promise.all([
        orderService.getOrders(),
        conversationService.getConversations(),
      ]);
      setPendingOrdersCount(orders.filter((o) => o.status === 'confirmed').length);
      setWaitingChatsCount(convs.filter((c) => c.status === 'human_pending').length);
    } catch {
      // Ignore background counter refresh failure
    }
  };

  const handleNavigate = (view: NavItemKey) => {
    setActiveView(view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectOrderFromDashboard = (orderId: string) => {
    setSelectedOrderId(orderId);
    setActiveView('orders');
  };

  const handleSelectConversationFromDashboard = (convId: string) => {
    setSelectedConversationId(convId);
    setActiveView('conversations');
  };

  const handleNavigateToChatByPhone = (_phone: string) => {
    setActiveView('conversations');
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-300 text-sm font-medium">Verificando sesión segura...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginView />;
  }

  if (isBizLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-600 text-sm font-medium">Cargando negocios autorizados...</p>
        </div>
      </div>
    );
  }

  if (bizError) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl p-6 border border-slate-200 shadow-xl text-center space-y-4">
          <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-full mx-auto flex items-center justify-center">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Acceso a Negocios Restringido</h2>
            <p className="text-xs text-slate-500 mt-1">{bizError}</p>
          </div>
          <div className="flex gap-2 justify-center pt-2">
            <Button variant="outline" size="sm" onClick={() => refreshBusinessData()}>
              Reintentar
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => signOut()}
              leftIcon={<LogOut className="w-4 h-4" />}
            >
              Cerrar Sesión
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <Sidebar
        activeView={activeView}
        onNavigate={handleNavigate}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        pendingOrdersCount={pendingOrdersCount}
        waitingChatsCount={waitingChatsCount}
      />

      {/* Main Content Area */}
      <div className="flex-1 md:pl-64 flex flex-col min-w-0">
        <Topbar
          activeView={activeView}
          onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
          isAcceptingOrders={isAcceptingOrders}
          onToggleAcceptingOrders={setIsAcceptingOrders}
          waitingChatsCount={waitingChatsCount}
        />

        <main className="flex-1">
          {activeView === 'dashboard' && (
            <DashboardView
              onNavigate={handleNavigate}
              onSelectOrder={handleSelectOrderFromDashboard}
              onSelectConversation={handleSelectConversationFromDashboard}
            />
          )}

          {activeView === 'orders' && (
            <OrdersView
              initialOrderId={selectedOrderId}
              onNavigateToChat={handleNavigateToChatByPhone}
              onNavigate={handleNavigate}
            />
          )}

          {activeView === 'conversations' && (
            <ConversationsView
              initialConversationId={selectedConversationId}
              onNavigateToOrder={handleSelectOrderFromDashboard}
              onNavigate={handleNavigate}
            />
          )}

          {activeView === 'menu' && <MenuView />}

          {activeView === 'customers' && (
            <CustomersView onNavigateToChat={handleNavigateToChatByPhone} />
          )}

          {activeView === 'metrics' && <MetricsView />}

          {activeView === 'settings' && <SettingsView />}
        </main>
      </div>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <SessionProvider>
      <BusinessProvider>
        <AdminLayout />
      </BusinessProvider>
    </SessionProvider>
  );
};

export default App;
