import type {
  Me,
  Business,
  BusinessSettings,
  SettingsUpdate,
  Category,
  CategoryInput,
  CategoryUpdate,
  Product,
  ProductInput,
  ProductUpdate,
  ProductOption,
  ProductOptionInput,
  ProductOptionUpdate,
  Order,
  OrderTransitionInput,
  Payment,
  PaymentRecordInput,
  DeliveryZone,
  DeliveryZoneInput,
  DeliveryZoneUpdate,
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

export interface Phase4TaxPolicy {
  mode: 'none' | 'exclusive';
  rate_bps: number;
  rounding: 'per_line_half_up';
}

export type Phase4BusinessSettings = BusinessSettings & {
  tax_policy?: Phase4TaxPolicy | null;
};

export type Phase4SettingsUpdate = SettingsUpdate & {
  tax_policy?: Phase4TaxPolicy | null;
};

export interface Phase4ModifierGroup {
  id: string;
  business_id: string;
  product_id: string;
  name: string;
  required: boolean;
  min_select: number;
  max_select: number;
  sort_order: number;
  active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Phase4ModifierOption {
  id: string;
  business_id: string;
  modifier_group_id: string;
  name: string;
  price_delta_minor: number;
  available: boolean;
  sort_order: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export type Phase4Product = Product & {
  modifier_groups?: Array<Phase4ModifierGroup & { options: Phase4ModifierOption[] }>;
};

export type Phase4ModifierGroupInput = Pick<
  Phase4ModifierGroup,
  'name' | 'required' | 'min_select' | 'max_select' | 'sort_order' | 'active'
>;

export type Phase4ModifierGroupUpdate = Partial<Phase4ModifierGroupInput> & {
  expected_version: number;
};

export type Phase4ModifierOptionInput = Pick<
  Phase4ModifierOption,
  'name' | 'price_delta_minor' | 'available' | 'sort_order'
>;

export type Phase4ModifierOptionUpdate = Partial<Phase4ModifierOptionInput> & {
  expected_version: number;
};

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
  async getSettings(businessId?: string, options?: RequestOptions): Promise<Phase4BusinessSettings> {
    return this.client.businessRequest<Phase4BusinessSettings>('/settings', { ...options, businessId });
  }

  async updateSettings(
    update: Phase4SettingsUpdate,
    idempotencyKey?: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<Phase4BusinessSettings> {
    return this.client.businessRequest<Phase4BusinessSettings>('/settings', {
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

  async createCategory(
    input: CategoryInput,
    idempotencyKey?: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<Category> {
    return this.client.businessRequest<Category>('/categories', {
      ...options,
      businessId,
      method: 'POST',
      idempotencyKey,
      body: JSON.stringify(input),
    });
  }

  async updateCategory(
    categoryId: string,
    update: CategoryUpdate,
    idempotencyKey?: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<Category> {
    return this.client.businessRequest<Category>(`/categories/${categoryId}`, {
      ...options,
      businessId,
      method: 'PATCH',
      idempotencyKey,
      body: JSON.stringify(update),
    });
  }

  async deleteCategory(
    categoryId: string,
    expectedVersion: number,
    idempotencyKey?: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<Category> {
    return this.client.businessRequest<Category>(`/categories/${categoryId}?expected_version=${expectedVersion}`, {
      ...options,
      businessId,
      method: 'DELETE',
      idempotencyKey,
    });
  }

  // /v1/businesses/{business_id}/products
  async getProducts(
    params?: { category_id?: string; available?: boolean },
    businessId?: string,
    options?: RequestOptions
  ): Promise<Phase4Product[]> {
    const query = new URLSearchParams();
    if (params?.category_id) query.set('category_id', params.category_id);
    if (params?.available !== undefined) query.set('available', String(params.available));
    const qs = query.toString() ? `?${query.toString()}` : '';
    return this.client.businessRequest<Phase4Product[]>(`/products${qs}`, { ...options, businessId });
  }

  async getProductById(
    productId: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<Phase4Product> {
    return this.client.businessRequest<Phase4Product>(`/products/${productId}`, { ...options, businessId });
  }

  async createProduct(
    input: ProductInput,
    idempotencyKey?: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<Phase4Product> {
    return this.client.businessRequest<Phase4Product>('/products', {
      ...options,
      businessId,
      method: 'POST',
      idempotencyKey,
      body: JSON.stringify(input),
    });
  }

  async updateProduct(
    productId: string,
    update: ProductUpdate,
    idempotencyKey?: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<Phase4Product> {
    return this.client.businessRequest<Phase4Product>(`/products/${productId}`, {
      ...options,
      businessId,
      method: 'PATCH',
      idempotencyKey,
      body: JSON.stringify(update),
    });
  }

  async deleteProduct(
    productId: string,
    expectedVersion: number,
    idempotencyKey?: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<Phase4Product> {
    return this.client.businessRequest<Phase4Product>(`/products/${productId}?expected_version=${expectedVersion}`, {
      ...options,
      businessId,
      method: 'DELETE',
      idempotencyKey,
    });
  }

  // Phase 4 canonical hierarchical modifier contract
  async getModifierGroups(
    productId: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<Phase4ModifierGroup[]> {
    return this.client.businessRequest<Phase4ModifierGroup[]>(
      `/products/${productId}/modifier-groups`,
      { ...options, businessId }
    );
  }

  async createModifierGroup(
    productId: string,
    input: Phase4ModifierGroupInput,
    idempotencyKey: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<Phase4ModifierGroup> {
    return this.client.businessRequest<Phase4ModifierGroup>(
      `/products/${productId}/modifier-groups`,
      { ...options, businessId, method: 'POST', idempotencyKey, body: JSON.stringify(input) }
    );
  }

  async updateModifierGroup(
    productId: string,
    groupId: string,
    update: Phase4ModifierGroupUpdate,
    idempotencyKey: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<Phase4ModifierGroup> {
    return this.client.businessRequest<Phase4ModifierGroup>(
      `/products/${productId}/modifier-groups/${groupId}`,
      { ...options, businessId, method: 'PATCH', idempotencyKey, body: JSON.stringify(update) }
    );
  }

  async deleteModifierGroup(
    productId: string,
    groupId: string,
    expectedVersion: number,
    idempotencyKey: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<void> {
    return this.client.businessRequest<void>(
      `/products/${productId}/modifier-groups/${groupId}?expected_version=${expectedVersion}`,
      { ...options, businessId, method: 'DELETE', idempotencyKey }
    );
  }

  async getModifierOptions(
    productId: string,
    groupId: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<Phase4ModifierOption[]> {
    return this.client.businessRequest<Phase4ModifierOption[]>(
      `/products/${productId}/modifier-groups/${groupId}/options`,
      { ...options, businessId }
    );
  }

  async createModifierOption(
    productId: string,
    groupId: string,
    input: Phase4ModifierOptionInput,
    idempotencyKey: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<Phase4ModifierOption> {
    return this.client.businessRequest<Phase4ModifierOption>(
      `/products/${productId}/modifier-groups/${groupId}/options`,
      { ...options, businessId, method: 'POST', idempotencyKey, body: JSON.stringify(input) }
    );
  }

  async updateModifierOption(
    productId: string,
    groupId: string,
    optionId: string,
    update: Phase4ModifierOptionUpdate,
    idempotencyKey: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<Phase4ModifierOption> {
    return this.client.businessRequest<Phase4ModifierOption>(
      `/products/${productId}/modifier-groups/${groupId}/options/${optionId}`,
      { ...options, businessId, method: 'PATCH', idempotencyKey, body: JSON.stringify(update) }
    );
  }

  async deleteModifierOption(
    productId: string,
    groupId: string,
    optionId: string,
    expectedVersion: number,
    idempotencyKey: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<void> {
    return this.client.businessRequest<void>(
      `/products/${productId}/modifier-groups/${groupId}/options/${optionId}?expected_version=${expectedVersion}`,
      { ...options, businessId, method: 'DELETE', idempotencyKey }
    );
  }

  // /v1/businesses/{business_id}/products/{product_id}/options
  async createProductOption(
    productId: string,
    input: ProductOptionInput,
    idempotencyKey?: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<ProductOption> {
    return this.client.businessRequest<ProductOption>(`/products/${productId}/options`, {
      ...options,
      businessId,
      method: 'POST',
      idempotencyKey,
      body: JSON.stringify(input),
    });
  }

  async updateProductOption(
    productId: string,
    optionId: string,
    update: ProductOptionUpdate,
    idempotencyKey?: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<ProductOption> {
    return this.client.businessRequest<ProductOption>(`/products/${productId}/options/${optionId}`, {
      ...options,
      businessId,
      method: 'PATCH',
      idempotencyKey,
      body: JSON.stringify(update),
    });
  }

  async deleteProductOption(
    productId: string,
    optionId: string,
    expectedVersion: number,
    idempotencyKey?: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<ProductOption> {
    return this.client.businessRequest<ProductOption>(
      `/products/${productId}/options/${optionId}?expected_version=${expectedVersion}`,
      {
        ...options,
        businessId,
        method: 'DELETE',
        idempotencyKey,
      }
    );
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

  // /v1/businesses/{business_id}/orders/{order_id}/payments
  async getOrderPayments(
    orderId: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<Payment[]> {
    return this.client.businessRequest<Payment[]>(`/orders/${orderId}/payments`, {
      ...options,
      businessId,
    });
  }

  // /v1/businesses/{business_id}/orders/{order_id}/payments/cash-record
  async recordCashPayment(
    orderId: string,
    input: PaymentRecordInput,
    idempotencyKey: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<Payment> {
    return this.client.businessRequest<Payment>(`/orders/${orderId}/payments/cash-record`, {
      ...options,
      businessId,
      method: 'POST',
      idempotencyKey,
      body: JSON.stringify(input),
    });
  }

  // /v1/businesses/{business_id}/delivery-zones
  async getDeliveryZones(businessId?: string, options?: RequestOptions): Promise<DeliveryZone[]> {
    return this.client.businessRequest<DeliveryZone[]>('/delivery-zones', {
      ...options,
      businessId,
    });
  }

  async createDeliveryZone(
    input: DeliveryZoneInput,
    idempotencyKey?: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<DeliveryZone> {
    return this.client.businessRequest<DeliveryZone>('/delivery-zones', {
      ...options,
      businessId,
      method: 'POST',
      idempotencyKey,
      body: JSON.stringify(input),
    });
  }

  async updateDeliveryZone(
    zoneId: string,
    update: DeliveryZoneUpdate,
    idempotencyKey?: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<DeliveryZone> {
    return this.client.businessRequest<DeliveryZone>(`/delivery-zones/${zoneId}`, {
      ...options,
      businessId,
      method: 'PATCH',
      idempotencyKey,
      body: JSON.stringify(update),
    });
  }

  async deleteDeliveryZone(
    zoneId: string,
    expectedVersion: number,
    idempotencyKey?: string,
    businessId?: string,
    options?: RequestOptions
  ): Promise<DeliveryZone> {
    return this.client.businessRequest<DeliveryZone>(
      `/delivery-zones/${zoneId}?expected_version=${expectedVersion}`,
      {
        ...options,
        businessId,
        method: 'DELETE',
        idempotencyKey,
      }
    );
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
