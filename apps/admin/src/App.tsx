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

export const App: React.FC = () => {
  const [activeView, setActiveView] = useState<NavItemKey>('dashboard');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isAcceptingOrders, setIsAcceptingOrders] = useState(true);
  const [selectedOrderId, setSelectedOrderId] = useState<string | undefined>();
  const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>();
  const [pendingOrdersCount, setPendingOrdersCount] = useState(1);
  const [waitingChatsCount, setWaitingChatsCount] = useState(1);

  useEffect(() => {
    refreshCounters();
  }, [activeView]);

  const refreshCounters = async () => {
    try {
      const [orders, convs] = await Promise.all([
        orderService.getOrders(),
        conversationService.getConversations(),
      ]);
      setPendingOrdersCount(orders.filter((o) => o.status === 'pending').length);
      setWaitingChatsCount(convs.filter((c) => c.status === 'waiting_human').length);
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
    // Look up conversation by phone or just open conversations
    setActiveView('conversations');
  };

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
export default App;
