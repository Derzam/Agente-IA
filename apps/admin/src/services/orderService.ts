import { Order, OrderStatus } from '@/types/viewModels';
import { mockOrders } from '@/mocks/mockData';
import { USE_MOCK_DATA, request } from './apiClient';

let localOrders: Order[] = [...mockOrders];

export const orderService = {
  async getOrders(): Promise<Order[]> {
    if (USE_MOCK_DATA) {
      return Promise.resolve([...localOrders]);
    }
    return request<Order[]>('/orders');
  },

  async getOrderById(id: string): Promise<Order | undefined> {
    if (USE_MOCK_DATA) {
      return Promise.resolve(localOrders.find((o) => o.id === id));
    }
    return request<Order>(`/orders/${id}`);
  },

  async updateOrderStatus(id: string, status: OrderStatus, note?: string): Promise<Order> {
    if (USE_MOCK_DATA) {
      const index = localOrders.findIndex((o) => o.id === id);
      if (index === -1) throw new Error('Order not found');
      const updated: Order = {
        ...localOrders[index],
        status,
        updatedAt: new Date().toISOString(),
        kitchenNotes: note ? `${localOrders[index].kitchenNotes || ''} | ${note}` : localOrders[index].kitchenNotes,
      };
      if (status === 'delivered') {
        updated.completedAt = new Date().toISOString();
      }
      localOrders[index] = updated;
      return Promise.resolve(updated);
    }
    return request<Order>(`/orders/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, note }),
    });
  },

  async cancelOrder(id: string, reason: string): Promise<Order> {
    if (USE_MOCK_DATA) {
      const index = localOrders.findIndex((o) => o.id === id);
      if (index === -1) throw new Error('Order not found');
      const updated: Order = {
        ...localOrders[index],
        status: 'cancelled',
        cancellationReason: reason,
        updatedAt: new Date().toISOString(),
      };
      localOrders[index] = updated;
      return Promise.resolve(updated);
    }
    return request<Order>(`/orders/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },
};
