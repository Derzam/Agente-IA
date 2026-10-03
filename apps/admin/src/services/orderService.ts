import type { Order, OrderStatus } from '@/types/viewModels';
import type { OrderAction } from '@agente-ia/shared';
import { mockOrders } from '@/mocks/mockData';
import { USE_MOCK_DATA, newIdempotencyKey } from './apiClient';
import { endpoints } from '@/api/endpoints';
import { mapDtoOrderToViewModel } from '@/adapters/orderAdapter';
import type { RequestOptions } from '@/api/types';

let localOrders: Order[] = [...mockOrders];

export const orderService = {
  async getOrders(
    params?: { status?: string; limit?: number; cursor?: string },
    options?: RequestOptions
  ): Promise<Order[]> {
    if (USE_MOCK_DATA) {
      if (params?.status && params.status !== 'all') {
        return Promise.resolve(localOrders.filter((o) => o.status === params.status));
      }
      return Promise.resolve([...localOrders]);
    }

    const dtoList = await endpoints.getOrders(params, undefined, options);
    return dtoList.map((dto) => mapDtoOrderToViewModel(dto));
  },

  async getOrderById(id: string, options?: RequestOptions): Promise<Order | undefined> {
    if (USE_MOCK_DATA) {
      return Promise.resolve(localOrders.find((o) => o.id === id));
    }

    const dto = await endpoints.getOrderById(id, undefined, options);
    return mapDtoOrderToViewModel(dto);
  },

  /**
   * Executes a canonical lifecycle transition via POST /orders/{id}/transitions.
   * Strictly adheres to OpenAPI specification and requires expected_version and Idempotency-Key.
   */
  async transitionOrder(
    id: string,
    action: OrderAction,
    expectedVersion: number,
    reason: string | null = null,
    idempotencyKey?: string,
    options?: RequestOptions
  ): Promise<Order> {
    const key = idempotencyKey || newIdempotencyKey();

    if (USE_MOCK_DATA) {
      const index = localOrders.findIndex((o) => o.id === id);
      if (index === -1) throw new Error('Order not found');

      const current = localOrders[index];
      let newStatus: OrderStatus = current.status;

      switch (action) {
        case 'accept':
          newStatus = 'accepted';
          break;
        case 'start_preparation':
          newStatus = 'preparing';
          break;
        case 'mark_ready':
          newStatus = 'ready';
          break;
        case 'dispatch':
          newStatus = 'out_for_delivery';
          break;
        case 'complete':
          newStatus = 'delivered';
          break;
        case 'cancel':
          newStatus = 'cancelled';
          break;
      }

      const updated: Order = {
        ...current,
        status: newStatus,
        version: (current.version || 1) + 1,
        updatedAt: new Date().toISOString(),
        completedAt: newStatus === 'delivered' ? new Date().toISOString() : current.completedAt,
        cancellationReason: action === 'cancel' ? reason || 'Cancelado por administración' : current.cancellationReason,
      };

      localOrders[index] = updated;
      return Promise.resolve(updated);
    }

    const updatedDto = await endpoints.postOrderTransition(
      id,
      {
        action,
        expected_version: expectedVersion,
        reason,
      },
      key,
      undefined,
      options
    );

    return mapDtoOrderToViewModel(updatedDto);
  },

  /**
   * Helper for canceling an order via the canonical 'cancel' transition.
   */
  async cancelOrder(
    id: string,
    expectedVersion: number,
    reason: string,
    idempotencyKey?: string,
    options?: RequestOptions
  ): Promise<Order> {
    return this.transitionOrder(id, 'cancel', expectedVersion, reason, idempotencyKey, options);
  },
};
