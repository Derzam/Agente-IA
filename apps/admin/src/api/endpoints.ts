import type {
  Me,
  Business,
  BusinessSettings,
  SettingsUpdate,
  Category,
  Product,
  ProductUpdate,
  Order,
  OrderTransitionInput,
  Customer,
  Conversation,
  Message,
  HumanMessageInput,
  MessageReceipt,
  HumanHandoff,
  HandoffCreateInput,
  HandoffClaimInput,
  HandoffResolveInput,
  Metrics,
} from '@agente-ia/shared';
import { ApiClient, defaultApiClient } from './client';
import { RequestOptions } from './types';

export class ApiEndpoints {
  constructor(private client: ApiClient = defaultApiClient) {}

  // /v1/me
  async getMe(options?: RequestOptions): Promise<Me> {
    return this.client.request<Me>('/me', options);
  }

  // /v1/businesses/{business_id}
  async getBusiness(businessId?: string, options?: RequestOptions): Promise<Business> {
    return this.client.businessRequest<Business>('', { ...options, businessId });
  }

  // /v1/businesses/{business_id}/settings
  async getSettings(businessId?: string, options?: RequestOptions): Promise<BusinessSettings> {
    return this.client.businessRequest<BusinessSettings>('/settings', { ...options, businessId });
  }

  async updateSettings(
    update: SettingsUpdate,
    idempotencyKey?: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<BusinessSettings> {
    return this.client.businessRequest<BusinessSettings>('/settings', {
      ...options,
      businessId,
      method: 'PATCH',
      idempotencyKey,
      body: JSON.stringify(update),
    });
  }

  // /v1/businesses/{business_id}/categories
  async getCategories(businessId?: string, options?: RequestOptions): Promise<Category[]> {
    return this.client.businessRequest<Category[]>('/categories', { ...options, businessId });
  }

  // /v1/businesses/{business_id}/products
  async getProducts(
    params?: { category_id?: string; available?: boolean },
    businessId?: string,
    options?: RequestOptions
  ): Promise<Product[]> {
    const query = new URLSearchParams();
    if (params?.category_id) query.set('category_id', params.category_id);
    if (params?.available !== undefined) query.set('available', String(params.available));
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.client.businessRequest<Product[]>(`/products${qs}`, { ...options, businessId });
  }

  async updateProduct(
    productId: string,
    update: ProductUpdate,
    idempotencyKey?: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<Product> {
    return this.client.businessRequest<Product>(`/products/${productId}`, {
      ...options,
      businessId,
      method: 'PATCH',
      idempotencyKey,
      body: JSON.stringify(update),
    });
  }

  // /v1/businesses/{business_id}/orders
  async getOrders(
    params?: { status?: string; customer_id?: string; limit?: number; cursor?: string },
    businessId?: string,
    options?: RequestOptions
  ): Promise<Order[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.customer_id) query.set('customer_id', params.customer_id);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.cursor) query.set('cursor', params.cursor);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.client.businessRequest<Order[]>(`/orders${qs}`, { ...options, businessId });
  }

  async getOrderById(orderId: string, businessId?: string, options?: RequestOptions): Promise<Order> {
    return this.client.businessRequest<Order>(`/orders/${orderId}`, { ...options, businessId });
  }

  async postOrderTransition(
    orderId: string,
    input: OrderTransitionInput,
    idempotencyKey: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<Order> {
    return this.client.businessRequest<Order>(`/orders/${orderId}/transitions`, {
      ...options,
      businessId,
      method: 'POST',
      idempotencyKey,
      body: JSON.stringify(input),
    });
  }

  // /v1/businesses/{business_id}/customers
  async getCustomers(
    params?: { limit?: number; cursor?: string },
    businessId?: string,
    options?: RequestOptions
  ): Promise<Customer[]> {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.cursor) query.set('cursor', params.cursor);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.client.businessRequest<Customer[]>(`/customers${qs}`, { ...options, businessId });
  }

  async getCustomerById(customerId: string, businessId?: string, options?: RequestOptions): Promise<Customer> {
    return this.client.businessRequest<Customer>(`/customers/${customerId}`, { ...options, businessId });
  }

  // /v1/businesses/{business_id}/conversations
  async getConversations(
    params?: { status?: string; limit?: number; cursor?: string },
    businessId?: string,
    options?: RequestOptions
  ): Promise<Conversation[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.cursor) query.set('cursor', params.cursor);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.client.businessRequest<Conversation[]>(`/conversations${qs}`, { ...options, businessId });
  }

  async getConversationById(
    conversationId: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<Conversation> {
    return this.client.businessRequest<Conversation>(`/conversations/${conversationId}`, {
      ...options,
      businessId,
    });
  }

  // /v1/businesses/{business_id}/conversations/{conversation_id}/messages
  async getMessages(
    conversationId: string,
    params?: { limit?: number; cursor?: string },
    businessId?: string,
    options?: RequestOptions
  ): Promise<Message[]> {
    const query = new URLSearchParams();
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.cursor) query.set('cursor', params.cursor);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.client.businessRequest<Message[]>(`/conversations/${conversationId}/messages${qs}`, {
      ...options,
      businessId,
    });
  }

  async sendMessage(
    conversationId: string,
    input: HumanMessageInput,
    idempotencyKey: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<MessageReceipt> {
    return this.client.businessRequest<MessageReceipt>(`/conversations/${conversationId}/messages`, {
      ...options,
      businessId,
      method: 'POST',
      idempotencyKey,
      body: JSON.stringify(input),
    });
  }

  // /v1/businesses/{business_id}/handoffs
  async getHandoffs(
    params?: { status?: string; limit?: number; cursor?: string },
    businessId?: string,
    options?: RequestOptions
  ): Promise<HumanHandoff[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.cursor) query.set('cursor', params.cursor);
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.client.businessRequest<HumanHandoff[]>(`/handoffs${qs}`, { ...options, businessId });
  }

  async createHandoff(
    conversationId: string,
    input: HandoffCreateInput,
    idempotencyKey: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<HumanHandoff> {
    return this.client.businessRequest<HumanHandoff>(`/conversations/${conversationId}/handoffs`, {
      ...options,
      businessId,
      method: 'POST',
      idempotencyKey,
      body: JSON.stringify(input),
    });
  }

  async claimHandoff(
    handoffId: string,
    input: HandoffClaimInput,
    idempotencyKey: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<HumanHandoff> {
    return this.client.businessRequest<HumanHandoff>(`/handoffs/${handoffId}/claim`, {
      ...options,
      businessId,
      method: 'POST',
      idempotencyKey,
      body: JSON.stringify(input),
    });
  }

  async resolveHandoff(
    handoffId: string,
    input: HandoffResolveInput,
    idempotencyKey: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<HumanHandoff> {
    return this.client.businessRequest<HumanHandoff>(`/handoffs/${handoffId}/resolve`, {
      ...options,
      businessId,
      method: 'POST',
      idempotencyKey,
      body: JSON.stringify(input),
    });
  }

  // /v1/businesses/{business_id}/metrics
  async getMetrics(
    from: string,
    to: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<Metrics> {
    const query = new URLSearchParams({ from, to });
    return this.client.businessRequest<Metrics>(`/metrics?${query.toString()}`, {
      ...options,
      businessId,
    });
  }
}

export const endpoints = new ApiEndpoints();
