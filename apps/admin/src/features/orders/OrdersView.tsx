import React, { useEffect, useState } from 'react';
import {
  Kanban,
  Table as TableIcon,
  Printer,
  Ban,
  MapPin,
  Phone,
  Clock,
  MessageSquare,
  AlertCircle,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/common/Button';
import { FilterBar } from '@/components/common/FilterBar';
import { OrderStatusBadge, FulfillmentBadge } from '@/components/common/StatusBadge';
import { Drawer } from '@/components/common/Drawer';
import { Modal } from '@/components/common/Modal';
import { EmptyState } from '@/components/common/EmptyState';
import { orderService } from '@/services/orderService';
import { Order, OrderStatus } from '@/types/viewModels';
import { NavItemKey } from '@/components/layout/Sidebar';

interface OrdersViewProps {
  initialOrderId?: string;
  onNavigateToChat?: (customerPhone: string) => void;
  onNavigate?: (view: NavItemKey) => void;
}

export const OrdersView: React.FC<OrdersViewProps> = ({
  initialOrderId,
  onNavigateToChat,
}) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadOrders();
  }, []);

  useEffect(() => {
    if (initialOrderId && orders.length > 0) {
      const found = orders.find((o) => o.id === initialOrderId);
      if (found) setSelectedOrder(found);
    }
  }, [initialOrderId, orders]);

  const loadOrders = async () => {
    setIsLoading(true);
    try {
      const data = await orderService.getOrders();
      setOrders(data);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStatusChange = async (orderId: string, newStatus: OrderStatus) => {
    const updated = await orderService.updateOrderStatus(orderId, newStatus);
    setOrders((prev) => prev.map((o) => (o.id === orderId ? updated : o)));
    if (selectedOrder?.id === orderId) {
      setSelectedOrder(updated);
    }
  };

  const handleCancelOrder = async () => {
    if (!selectedOrder || !cancelReason.trim()) return;
    const updated = await orderService.cancelOrder(selectedOrder.id, cancelReason);
    setOrders((prev) => prev.map((o) => (o.id === selectedOrder.id ? updated : o)));
    setSelectedOrder(updated);
    setIsCancelModalOpen(false);
    setCancelReason('');
  };

  // Filter orders
  const filteredOrders = orders.filter((o) => {
    const matchesSearch =
      o.orderNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.customerPhone.includes(searchQuery);

    if (!matchesSearch) return false;
    if (selectedStatusFilter === 'all') return true;
    if (selectedStatusFilter === 'confirmed') return o.status === 'confirmed' || o.status === 'accepted';
    if (selectedStatusFilter === 'preparing') return o.status === 'preparing';
    if (selectedStatusFilter === 'active_dispatch')
      return o.status === 'out_for_delivery' || o.status === 'ready';
    if (selectedStatusFilter === 'delivered') return o.status === 'delivered';
    if (selectedStatusFilter === 'cancelled') return o.status === 'cancelled';
    return true;
  });

  const columns: { id: OrderStatus[]; title: string; subtitle: string; color: string }[] = [
    { id: ['confirmed', 'accepted'], title: 'Nuevos Pedidos', subtitle: 'Confirmados por WhatsApp', color: 'border-amber-400 bg-amber-50/20' },
    { id: ['preparing'], title: 'En Preparación', subtitle: 'En plancha o freidora', color: 'border-blue-400 bg-blue-50/20' },
    { id: ['out_for_delivery', 'ready'], title: 'Despacho & Retiro', subtitle: 'En ruta o en mostrador', color: 'border-indigo-400 bg-indigo-50/20' },
    { id: ['delivered'], title: 'Entregados', subtitle: 'Servicio completado hoy', color: 'border-emerald-400 bg-emerald-50/10' },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-7xl mx-auto">
      {/* Top Filter & View Toggle Bar */}
      <FilterBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Buscar por # pedido, cliente o celular..."
        filters={[
          { id: 'all', label: 'Todos', active: selectedStatusFilter === 'all', count: orders.length, onClick: () => setSelectedStatusFilter('all') },
          { id: 'confirmed', label: 'Nuevos', active: selectedStatusFilter === 'confirmed', count: orders.filter((o) => o.status === 'confirmed' || o.status === 'accepted').length, onClick: () => setSelectedStatusFilter('confirmed') },
          { id: 'preparing', label: 'En Cocina', active: selectedStatusFilter === 'preparing', count: orders.filter((o) => o.status === 'preparing').length, onClick: () => setSelectedStatusFilter('preparing') },
          { id: 'active_dispatch', label: 'En Despacho', active: selectedStatusFilter === 'active_dispatch', count: orders.filter((o) => o.status === 'out_for_delivery' || o.status === 'ready').length, onClick: () => setSelectedStatusFilter('active_dispatch') },
          { id: 'delivered', label: 'Entregados', active: selectedStatusFilter === 'delivered', count: orders.filter((o) => o.status === 'delivered').length, onClick: () => setSelectedStatusFilter('delivered') },
        ]}
        actions={
          <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button
              onClick={() => setViewMode('kanban')}
              className={`p-1.5 rounded-md transition-all ${
                viewMode === 'kanban' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
              }`}
              title="Vista Tablero Kanban"
              aria-label="Vista Tablero Kanban"
            >
              <Kanban className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded-md transition-all ${
                viewMode === 'table' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
              }`}
              title="Vista Tabla Detallada"
              aria-label="Vista Tabla Detallada"
            >
              <TableIcon className="w-4 h-4" />
            </button>
          </div>
        }
      />

      {/* MAIN VIEW CONTENT: KANBAN OR TABLE */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-96 bg-white rounded-xl border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : filteredOrders.length === 0 ? (
        <EmptyState
          icon={<FileText className="w-8 h-8 text-slate-400" />}
          title="No se encontraron pedidos"
          description="No hay pedidos que coincidan con los filtros de búsqueda seleccionados."
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchQuery('');
                setSelectedStatusFilter('all');
              }}
            >
              Restablecer filtros
            </Button>
          }
        />
      ) : viewMode === 'kanban' ? (
        /* KANBAN BOARD */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
          {columns.map((col) => {
            const colOrders = filteredOrders.filter((o) => col.id.includes(o.status));
            return (
              <div key={col.title} className="flex flex-col rounded-2xl bg-slate-100/70 border border-slate-200 p-3 min-h-[500px]">
                {/* Column Header */}
                <div className="p-2 mb-2 flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-800 text-sm">{col.title}</h3>
                    <p className="text-[11px] text-slate-500">{col.subtitle}</p>
                  </div>
                  <span className="w-6 h-6 rounded-full bg-white border border-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center shadow-2xs">
                    {colOrders.length}
                  </span>
                </div>

                {/* Column Cards */}
                <div className="space-y-3 flex-1">
                  {colOrders.map((order) => (
                    <div
                      key={order.id}
                      onClick={() => setSelectedOrder(order)}
                      className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-2xs hover:shadow-md transition-all cursor-pointer space-y-2.5 group"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 text-sm">{order.orderNumber}</span>
                        <FulfillmentBadge type={order.fulfillmentType} size="sm" />
                      </div>

                      <div className="text-xs space-y-1">
                        <p className="font-semibold text-slate-800">{order.customerName}</p>
                        <p className="text-slate-500 flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span>hace {Math.max(1, Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000))} min</span>
                        </p>
                      </div>

                      {/* Items Preview */}
                      <div className="bg-slate-50 p-2 rounded-lg text-xs text-slate-700 space-y-0.5">
                        {order.items.slice(0, 2).map((item) => (
                          <p key={item.id} className="truncate">
                            <span className="font-semibold">{item.quantity}x</span> {item.name}
                          </p>
                        ))}
                        {order.items.length > 2 && (
                          <p className="text-[10px] text-slate-400 font-medium">
                            +{order.items.length - 2} productos más...
                          </p>
                        )}
                      </div>

                      {order.kitchenNotes && (
                        <p className="text-[11px] text-amber-900 bg-amber-50 p-1.5 rounded border border-amber-200 font-medium">
                          ⚠️ {order.kitchenNotes}
                        </p>
                      )}

                      {/* Card Footer: Price and Quick Transition Button */}
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-900 text-sm">${order.total.toFixed(2)}</span>

                        {order.status === 'confirmed' && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStatusChange(order.id, 'accepted');
                            }}
                          >
                            Aceptar
                          </Button>
                        )}
                        {order.status === 'accepted' && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStatusChange(order.id, 'preparing');
                            }}
                          >
                            A Cocina
                          </Button>
                        )}
                        {order.status === 'preparing' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStatusChange(order.id, 'ready');
                            }}
                          >
                            Listo
                          </Button>
                        )}
                        {order.status === 'ready' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStatusChange(
                                order.id,
                                order.fulfillmentType === 'delivery' ? 'out_for_delivery' : 'delivered'
                              );
                            }}
                          >
                            {order.fulfillmentType === 'delivery' ? 'Despachar' : 'Entregar'}
                          </Button>
                        )}
                        {order.status === 'out_for_delivery' && (
                          <Button
                            variant="success"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStatusChange(order.id, 'delivered');
                            }}
                          >
                            Entregar
                          </Button>
                        )}
                        {order.status === 'delivered' && (
                          <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                            ✓ Cerrado
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* TABLE VIEW */
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-700">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase border-b border-slate-200">
                <tr>
                  <th className="p-4">Pedido</th>
                  <th className="p-4">Cliente</th>
                  <th className="p-4">Productos</th>
                  <th className="p-4">Modalidad</th>
                  <th className="p-4">Estado</th>
                  <th className="p-4">Total</th>
                  <th className="p-4 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredOrders.map((order) => (
                  <tr
                    key={order.id}
                    onClick={() => setSelectedOrder(order)}
                    className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                  >
                    <td className="p-4 font-bold text-slate-900">{order.orderNumber}</td>
                    <td className="p-4">
                      <p className="font-semibold text-slate-800">{order.customerName}</p>
                      <p className="text-xs text-slate-400">{order.customerPhone}</p>
                    </td>
                    <td className="p-4 max-w-xs truncate text-xs text-slate-600">
                      {order.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}
                    </td>
                    <td className="p-4">
                      <FulfillmentBadge type={order.fulfillmentType} size="sm" />
                    </td>
                    <td className="p-4">
                      <OrderStatusBadge status={order.status} size="sm" />
                    </td>
                    <td className="p-4 font-bold text-slate-900">${order.total.toFixed(2)}</td>
                    <td className="p-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="sm" onClick={() => setSelectedOrder(order)}>
                        Detalles
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ORDER DETAILS DRAWER */}
      <Drawer
        isOpen={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
        title={selectedOrder?.orderNumber || 'Detalle del Pedido'}
        subtitle={
          selectedOrder && (
            <div className="flex items-center gap-2 mt-1">
              <OrderStatusBadge status={selectedOrder.status} size="sm" />
              <FulfillmentBadge type={selectedOrder.fulfillmentType} size="sm" />
            </div>
          )
        }
        footer={
          selectedOrder && (
            <div className="flex flex-col sm:flex-row gap-2 w-full justify-between items-center">
              <div className="flex gap-2 w-full sm:w-auto">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsPrintModalOpen(true)}
                  leftIcon={<Printer className="w-4 h-4" />}
                >
                  Imprimir Ticket
                </Button>
                {selectedOrder.status !== 'cancelled' && selectedOrder.status !== 'delivered' && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setIsCancelModalOpen(true)}
                    leftIcon={<Ban className="w-4 h-4" />}
                  >
                    Cancelar
                  </Button>
                )}
              </div>

              {/* Status advancement in drawer */}
              {selectedOrder.status === 'confirmed' && (
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => handleStatusChange(selectedOrder.id, 'accepted')}
                >
                  Aceptar pedido
                </Button>
              )}
              {selectedOrder.status === 'accepted' && (
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => handleStatusChange(selectedOrder.id, 'preparing')}
                >
                  Pasar a Cocina 👨‍🍳
                </Button>
              )}
              {selectedOrder.status === 'preparing' && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => handleStatusChange(selectedOrder.id, 'ready')}
                >
                  Marcar listo
                </Button>
              )}
              {selectedOrder.status === 'ready' && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() =>
                    handleStatusChange(
                      selectedOrder.id,
                      selectedOrder.fulfillmentType === 'delivery' ? 'out_for_delivery' : 'delivered'
                    )
                  }
                >
                  {selectedOrder.fulfillmentType === 'delivery' ? 'Despachar 🛵' : 'Entregar ✓'}
                </Button>
              )}
              {selectedOrder.status === 'out_for_delivery' && (
                <Button
                  variant="success"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => handleStatusChange(selectedOrder.id, 'delivered')}
                >
                  Marcar Entregado ✓
                </Button>
              )}
            </div>
          )
        }
      >
        {selectedOrder && (
          <div className="space-y-6">
            {/* Customer Info Card */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-slate-800 text-sm">{selectedOrder.customerName}</h4>
                  <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <span>{selectedOrder.customerPhone}</span>
                  </p>
                </div>
                {onNavigateToChat && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onNavigateToChat(selectedOrder.customerPhone);
                      setSelectedOrder(null);
                    }}
                    leftIcon={<MessageSquare className="w-3.5 h-3.5 text-orange-600" />}
                  >
                    Ver Chat
                  </Button>
                )}
              </div>

              {selectedOrder.fulfillmentType === 'delivery' && selectedOrder.deliveryAddress && (
                <div className="pt-3 border-t border-slate-200/80 text-xs text-slate-700 space-y-1">
                  <div className="flex items-start gap-1.5 font-medium">
                    <MapPin className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
                    <span>
                      {selectedOrder.deliveryAddress.street} {selectedOrder.deliveryAddress.number || ''},{' '}
                      {selectedOrder.deliveryAddress.apartmentOrFloor || ''}
                    </span>
                  </div>
                  {selectedOrder.deliveryAddress.reference && (
                    <p className="text-slate-500 pl-5 italic">
                      Ref: {selectedOrder.deliveryAddress.reference}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Kitchen Notes Warning */}
            {selectedOrder.kitchenNotes && (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs">
                <p className="font-bold flex items-center gap-1.5 mb-1">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  Instrucciones Especiales del Cliente:
                </p>
                <p className="italic">{selectedOrder.kitchenNotes}</p>
              </div>
            )}

            {/* Items Breakdown Table */}
            <div>
              <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wider mb-2">
                Productos del Pedido
              </h4>
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                {selectedOrder.items.map((item) => (
                  <div key={item.id} className="p-3 bg-white flex items-start justify-between gap-4 text-xs">
                    <div>
                      <p className="font-bold text-slate-800">
                        {item.quantity}x {item.name}
                      </p>
                      {item.notes && <p className="text-slate-500 italic mt-0.5">Nota: {item.notes}</p>}
                      <p className="text-slate-400 mt-0.5">${item.unitPrice.toFixed(2)} c/u</p>
                    </div>
                    <span className="font-bold text-slate-900">${item.subtotal.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Financial Summary */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal productos:</span>
                <span>${selectedOrder.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Envío delivery:</span>
                <span>${selectedOrder.deliveryFee.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-900 font-bold text-sm pt-2 border-t border-slate-200">
                <span>Total a cobrar:</span>
                <span className="text-orange-600">${selectedOrder.total.toFixed(2)}</span>
              </div>
              <div className="pt-2 text-[11px] text-slate-500 flex justify-between">
                <span>Método: {selectedOrder.paymentMethod}</span>
                <span className="capitalize font-semibold text-slate-700">Estado: {selectedOrder.paymentStatus}</span>
              </div>
            </div>
          </div>
        )}
      </Drawer>

      {/* CANCEL ORDER MODAL */}
      <Modal
        isOpen={isCancelModalOpen}
        onClose={() => setIsCancelModalOpen(false)}
        title="Cancelar Pedido Formalmente"
        maxWidth="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setIsCancelModalOpen(false)}>
              Volver
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!cancelReason.trim()}
              onClick={handleCancelOrder}
            >
              Confirmar Anulación
            </Button>
          </div>
        }
      >
        <div className="space-y-4 text-sm">
          <p className="text-slate-600">
            ¿Está seguro de anular el pedido <span className="font-bold text-slate-900">{selectedOrder?.orderNumber}</span>?
            Esta acción quedará registrada en la auditoría del restaurante.
          </p>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Motivo de anulación (Obligatorio):
            </label>
            <select
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="w-full text-xs p-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-orange-500"
            >
              <option value="">Seleccione un motivo...</option>
              <option value="Cliente solicitó cancelar">Cliente solicitó cancelar</option>
              <option value="Falta de insumos / stock agotado">Falta de insumos / stock agotado</option>
              <option value="Dirección fuera de cobertura">Dirección fuera de cobertura</option>
              <option value="Problema con el método de pago">Problema con el método de pago</option>
              <option value="Otro motivo">Otro motivo</option>
            </select>
          </div>
        </div>
      </Modal>

      {/* PRINT TICKET MODAL SIMULATION */}
      <Modal
        isOpen={isPrintModalOpen}
        onClose={() => setIsPrintModalOpen(false)}
        title="Vista Previa de Comanda Térmica (80mm)"
        maxWidth="sm"
        footer={
          <Button variant="primary" size="sm" onClick={() => setIsPrintModalOpen(false)}>
            Cerrar / Imprimir
          </Button>
        }
      >
        {selectedOrder && (
          <div className="bg-slate-50 p-4 border border-slate-300 font-mono text-xs rounded-lg text-slate-800 space-y-2">
            <div className="text-center border-b border-dashed border-slate-400 pb-2">
              <p className="font-bold text-sm">BURGER STATION</p>
              <p>Av. Principal 123, Miraflores</p>
              <p>WhatsApp: +51 987 654 321</p>
            </div>
            <div className="border-b border-dashed border-slate-400 pb-2 space-y-0.5">
              <p className="font-bold">ORDEN: {selectedOrder.orderNumber}</p>
              <p>FECHA: {selectedOrder.createdAt.slice(0, 10)} {selectedOrder.createdAt.slice(11, 16)}</p>
              <p>CLIENTE: {selectedOrder.customerName}</p>
              <p>TEL: {selectedOrder.customerPhone}</p>
              <p>TIPO: {selectedOrder.fulfillmentType.toUpperCase()}</p>
            </div>
            <div className="border-b border-dashed border-slate-400 pb-2 space-y-1">
              {selectedOrder.items.map((it) => (
                <div key={it.id} className="flex justify-between">
                  <span>{it.quantity}x {it.name}</span>
                  <span>${it.subtotal.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="space-y-0.5 pt-1">
              <div className="flex justify-between">
                <span>SUBTOTAL:</span>
                <span>${selectedOrder.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>DELIVERY:</span>
                <span>${selectedOrder.deliveryFee.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-sm">
                <span>TOTAL:</span>
                <span>${selectedOrder.total.toFixed(2)}</span>
              </div>
            </div>
            {selectedOrder.kitchenNotes && (
              <div className="pt-2 border-t border-dashed border-slate-400 text-center font-bold">
                *** NOTAS: {selectedOrder.kitchenNotes} ***
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};
