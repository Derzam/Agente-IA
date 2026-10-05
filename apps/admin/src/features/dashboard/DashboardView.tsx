import { RUNTIME_PRESENTATION } from '@/components/operations/runtimePresentation';
import React, { useState, useCallback } from 'react';
import {
  Clock,
  Flame,
  Bike,
  AlertTriangle,
  DollarSign,
  TrendingUp,
  ArrowRight,
  Bot,
  ShieldCheck,
  ExternalLink,
} from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { ApiErrorBanner } from '@/components/common/ApiErrorBanner';
import { OrderStatusBadge, FulfillmentBadge } from '@/components/common/StatusBadge';
import { metricsService } from '@/services/metricsService';
import { orderService } from '@/services/orderService';
import { conversationService } from '@/services/conversationService';
import { DashboardMetrics, Order, ConversationSummary } from '@/types/viewModels';
import type { OrderAction } from '@agente-ia/shared';
import { NavItemKey } from '@/components/layout/Sidebar';
import { usePolling } from '@/hooks/usePolling';

interface DashboardViewProps {
  onNavigate: (view: NavItemKey) => void;
  onSelectOrder?: (orderId: string) => void;
  onSelectConversation?: (convId: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onNavigate,
  onSelectOrder,
  onSelectConversation,
}) => {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [waitingChats, setWaitingChats] = useState<ConversationSummary[]>([]);
  const [apiError, setApiError] = useState<Error | null>(null);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    try {
      const [m, orders, convs] = await Promise.all([
        metricsService.getDashboardMetrics(undefined, { signal }),
        orderService.getOrders(undefined, { signal }),
        conversationService.getConversations(undefined, { signal }),
      ]);
      if (signal?.aborted) return;
      setMetrics(m);
      setActiveOrders(orders.filter((o: Order) => o.status !== 'delivered' && o.status !== 'cancelled'));
      setWaitingChats(convs.filter((c: ConversationSummary) => c.status === 'human_pending'));
      setApiError(null);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setApiError(err);
      }
      if (signal) throw err;
    }
  }, []);

  // Polling every 8 seconds while view is active
  usePolling({
    callback: async (signal) => {
      await loadData(signal);
    },
    intervalMs: 8000,
  });

  const handleQuickAdvance = async (
    orderId: string,
    currentStatus: Order['status'],
    fulfillmentType?: Order['fulfillmentType']
  ) => {
    let action: OrderAction | null = null;
    if (currentStatus === 'confirmed') action = 'accept';
    else if (currentStatus === 'accepted') action = 'start_preparation';
    else if (currentStatus === 'preparing') action = 'mark_ready';
    else if (currentStatus === 'ready') action = fulfillmentType === 'delivery' ? 'dispatch' : 'complete';
    else if (currentStatus === 'out_for_delivery') action = 'complete';

    if (!action) return;
    const order = activeOrders.find((o) => o.id === orderId);
    await orderService.transitionOrder(orderId, action, order?.version || 1);
    loadData();
  };

  if (!metrics) {
    if (apiError) {
      return (
        <div className="p-6 max-w-7xl mx-auto space-y-4">
          <ApiErrorBanner error={apiError} onRetry={() => loadData()} />
        </div>
      );
    }
    return (
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 bg-white rounded-xl border border-slate-200 animate-pulse p-4" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {apiError && (
        <ApiErrorBanner error={apiError} onRetry={() => loadData()} />
      )}

      {/* URGENT ALERT BANNER (If customers are waiting for human handoff) */}
      {waitingChats.length > 0 && (
        <div className="bg-rose-50 border-2 border-rose-300 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm animate-pulse">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-rose-600 text-white shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-rose-900 text-sm sm:text-base">
                {waitingChats.length === 1
                  ? '¡1 cliente esperando atención humana en WhatsApp!'
                  : `¡${waitingChats.length} clientes esperando atención humana en WhatsApp!`}
              </h4>
              <p className="text-xs text-rose-700">
                La IA ha pausado sus respuestas automáticas para permitir que un asesor responda.
              </p>
            </div>
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              if (onSelectConversation && waitingChats[0]) {
                onSelectConversation(waitingChats[0].id);
              }
              onNavigate('conversations');
            }}
            rightIcon={<ArrowRight className="w-4 h-4" />}
          >
            Atender Ahora
          </Button>
        </div>
      )}

      {/* KPI METRIC CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        {/* Nuevos Pedidos */}
        <div
          onClick={() => onNavigate('orders')}
          className={`cursor-pointer bg-white p-4 rounded-xl border transition-all hover:shadow-md ${
            metrics.newOrdersCount > 0 ? 'border-amber-400 bg-amber-50/30' : 'border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold">Nuevos</span>
            <Clock className={`w-4 h-4 ${metrics.newOrdersCount > 0 ? 'text-amber-500 animate-bounce' : 'text-slate-400'}`} />
          </div>
          <div className="text-2xl font-black text-slate-900">{metrics.newOrdersCount}</div>
          <span className="text-[11px] text-amber-700 font-medium">Por pasar a cocina</span>
        </div>

        {/* En Cocina */}
        <div
          onClick={() => onNavigate('orders')}
          className="cursor-pointer bg-white p-4 rounded-xl border border-slate-200 transition-all hover:shadow-md"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold">En Cocina</span>
            <Flame className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-black text-slate-900">{metrics.inKitchenCount}</div>
          <span className="text-[11px] text-blue-600 font-medium">En preparación</span>
        </div>

        {/* En Camino / Listos */}
        <div
          onClick={() => onNavigate('orders')}
          className="cursor-pointer bg-white p-4 rounded-xl border border-slate-200 transition-all hover:shadow-md"
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold">Despacho</span>
            <Bike className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-black text-slate-900">{metrics.readyOrDeliveringCount}</div>
          <span className="text-[11px] text-indigo-600 font-medium">En ruta o mostrador</span>
        </div>

        {/* Esperando Asesor */}
        <div
          onClick={() => onNavigate('conversations')}
          className={`cursor-pointer bg-white p-4 rounded-xl border transition-all hover:shadow-md ${
            metrics.waitingHumanChatsCount > 0 ? 'border-rose-400 bg-rose-50/40' : 'border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold">Esperando</span>
            <AlertTriangle className={`w-4 h-4 ${metrics.waitingHumanChatsCount > 0 ? 'text-rose-600' : 'text-slate-400'}`} />
          </div>
          <div className={`text-2xl font-black ${metrics.waitingHumanChatsCount > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
            {metrics.waitingHumanChatsCount}
          </div>
          <span className="text-[11px] text-rose-600 font-medium">Chats humanos</span>
        </div>

        {/* Ventas Hoy */}
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold">Ventas Hoy</span>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-slate-900">${metrics.dailySalesTotal.toFixed(2)}</div>
          <span className="text-[11px] text-emerald-600 font-medium">{metrics.completedTodayCount} órdenes completadas</span>
        </div>

        {/* Ticket Promedio */}
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold">Ticket Promedio</span>
            <TrendingUp className="w-4 h-4 text-orange-500" />
          </div>
          <div className="text-2xl font-black text-slate-900">${metrics.averageTicket.toFixed(2)}</div>
          <span className="text-[11px] text-slate-500">Por pedido</span>
        </div>
      </div>

      {/* TWO COLUMN OPERATIONAL SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Active Kitchen Orders (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader
              title={
                <div className="flex items-center gap-2">
                  <span>Pedidos en Curso</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 font-bold">
                    {activeOrders.length}
                  </span>
                </div>
              }
              subtitle="Pedidos confirmados por WhatsApp listos para operar"
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onNavigate('orders')}
                  rightIcon={<ArrowRight className="w-4 h-4" />}
                >
                  Ver Tablero Completo
                </Button>
              }
            />
            <CardBody className="p-0 divide-y divide-slate-100">
              {activeOrders.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-sm">
                  No hay pedidos pendientes en este momento.
                </div>
              ) : (
                activeOrders.map((order) => (
                  <div
                    key={order.id}
                    className="p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:bg-slate-50/80 transition-colors"
                  >
                    <div
                      className="space-y-1.5 flex-1 cursor-pointer"
                      onClick={() => {
                        if (onSelectOrder) onSelectOrder(order.id);
                        onNavigate('orders');
                      }}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 text-base">{order.orderNumber}</span>
                        <OrderStatusBadge status={order.status} size="sm" />
                        <FulfillmentBadge type={order.fulfillmentType} size="sm" />
                        <span className="text-xs text-slate-400">
                          {order.createdAt.slice(11, 16)} hrs
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-slate-700">
                        {order.customerName} ({order.customerPhone})
                      </p>
                      <p className="text-xs text-slate-500 line-clamp-1">
                        {order.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}
                      </p>
                      {order.kitchenNotes && (
                        <p className="text-xs text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 inline-block font-medium">
                          ⚠️ {order.kitchenNotes}
                        </p>
                      )}
                    </div>

                    <div className="flex sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto gap-2">
                      <span className="text-base font-bold text-slate-900">${order.total.toFixed(2)}</span>
                      {order.status === 'confirmed' && (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleQuickAdvance(order.id, order.status, order.fulfillmentType)}
                          leftIcon={<Flame className="w-3.5 h-3.5" />}
                        >
                          Pasar a Cocina
                        </Button>
                      )}
                      {order.status === 'preparing' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleQuickAdvance(order.id, order.status, order.fulfillmentType)}
                          leftIcon={<Bike className="w-3.5 h-3.5" />}
                        >
                          Listo Despacho
                        </Button>
                      )}
                      {order.status === 'out_for_delivery' && (
                        <Button
                          variant="success"
                          size="sm"
                          onClick={() => handleQuickAdvance(order.id, order.status, order.fulfillmentType)}
                        >
                          Marcar Entregado
                        </Button>
                      )}
                      {order.status === 'ready' && (
                        <Button
                          variant="success"
                          size="sm"
                          onClick={() => handleQuickAdvance(order.id, order.status, order.fulfillmentType)}
                        >
                          Marcar Retirado
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </div>

        {/* Right Column: Top Items & Bot Quick Actions (1 col) */}
        <div className="space-y-6">
          {/* Top Selling Today */}
          <Card>
            <CardHeader
              title="Más Pedidos del Turno"
              subtitle="Platos con mayor rotación hoy"
            />
            <CardBody className="p-0 divide-y divide-slate-100">
              {metrics.topSellingItems.map((item, index) => (
                <div key={item.id} className="p-3.5 sm:p-4 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-700 text-xs font-bold flex items-center justify-center">
                      {index + 1}
                    </span>
                    <div>
                      <p className="font-medium text-slate-800 line-clamp-1">{item.name}</p>
                      <p className="text-xs text-slate-400">{item.quantitySoldToday} unidades vendidas</p>
                    </div>
                  </div>
                  <span className="font-semibold text-slate-900">${item.revenueToday.toFixed(2)}</span>
                </div>
              ))}
            </CardBody>
          </Card>

          {/* Phase 5 Operational Runtime Status Box */}
          <div className="bg-slate-900 rounded-2xl p-5 text-white shadow-md relative overflow-hidden border border-slate-800">
            <div className="relative z-10 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-slate-300 text-xs font-bold uppercase tracking-wider">
                  <Bot className="w-4 h-4 text-sky-400" />
                  Operación & Runtime
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-sky-950 text-sky-300 border border-sky-800">
                  Fase 5 Staging
                </span>
              </div>
              <h4 className="text-sm font-bold text-white">Canales & Orquestación</h4>
              <div className="space-y-1.5 text-xs text-slate-300">
                <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                  <span className="text-slate-400">WhatsApp Sandbox:</span>
                  <span className="font-mono text-slate-300">{RUNTIME_PRESENTATION.meta.status}</span>
                </div>
                <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                  <span className="text-slate-400">OpenAI Responses:</span>
                  <span className="font-mono text-slate-300">{RUNTIME_PRESENTATION.openai.status}</span>
                </div>
                <div className="flex items-center justify-between border-b border-slate-800 pb-1">
                  <span className="text-slate-400">Atención en espera:</span>
                  <span className={`font-bold ${waitingChats.length > 0 ? 'text-rose-400' : 'text-slate-300'}`}>
                    {waitingChats.length > 0 ? `${waitingChats.length} pendiente(s)` : '0 en espera'}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-0.5">
                  <span className="text-slate-400">Hosting:</span>
                  <span className="text-amber-300 text-[11px]">{RUNTIME_PRESENTATION.hosting.status}</span>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
                El backend de Fase 5 está implementado, pero el panel no dispone todavía de endpoints públicos para verificar readiness de OpenAI, Meta o hosting.
              </p>
              <div className="pt-2 flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onNavigate('settings')}
                  className="bg-slate-800 text-white hover:bg-slate-700 border-slate-700 text-xs"
                >
                  Ver Ajustes IA
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onNavigate('conversations')}
                  className="text-slate-300 hover:text-white hover:bg-slate-800 text-xs"
                  rightIcon={<ExternalLink className="w-3.5 h-3.5" />}
                >
                  Conversaciones
                </Button>
              </div>
            </div>
            <ShieldCheck className="absolute -right-4 -bottom-6 w-32 h-32 text-slate-800/40 pointer-events-none" />
          </div>
        </div>
      </div>
    </div>
  );
};
