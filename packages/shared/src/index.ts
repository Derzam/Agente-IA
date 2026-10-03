/** Diseño v0.1; sin runtime. Ver docs/api/openapi.json. */
export type UUID = string;
export type Timestamp = string;
export type Role = 'owner' | 'manager' | 'operator';
export type OrderStatus = 'awaiting_confirmation' | 'confirmed' | 'accepted' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered' | 'cancelled';
export type OrderAction = 'accept' | 'start_preparation' | 'mark_ready' | 'dispatch' | 'complete' | 'cancel';
export type ConversationStatus = 'bot_active' | 'human_pending' | 'human_active' | 'closed';
export type HandoffReason = 'explicit_request' | 'misunderstanding' | 'complaint' | 'payment_issue' | 'system_failure';
export type ErrorCode = 'VALIDATION_ERROR' | 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VERSION_CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'REQUEST_IN_PROGRESS' | 'INVALID_ORDER_TRANSITION' | 'QUOTE_CHANGED' | 'QUOTE_EXPIRED' | 'PRODUCT_UNAVAILABLE' | 'DELIVERY_UNAVAILABLE' | 'BUSINESS_CLOSED' | 'HANDOFF_REQUIRED' | 'WINDOW_CLOSED' | 'RATE_LIMITED' | 'PROVIDER_UNAVAILABLE' | 'INTERNAL_ERROR';
export interface Entity { id: UUID; business_id: UUID; created_at: Timestamp; updated_at: Timestamp; version: number }
export interface Money { amount_minor: number; currency: string }
export interface Business extends Entity { name: string; slug: string; currency: string; timezone: string; status: 'active' | 'suspended' }
export interface Category extends Entity { name: string; sort_order: number; active: boolean }
export interface ProductOption extends Entity { product_id: UUID; group_key: string; name: string; price_delta_minor: number; required: boolean; min_select: number; max_select: number; available: boolean }
export interface Product extends Entity { category_id: UUID; name: string; description: string | null; price_minor: number; currency: string; available: boolean; image_url: string | null; options: ProductOption[] }
export interface Customer extends Entity { display_name: string | null; phone_masked: string | null }
export interface Address extends Entity { customer_id: UUID; address_text: string; latitude: number | null; longitude: number | null; instructions: string | null }
export interface AddressSnapshot { address_text: string; latitude: number | null; longitude: number | null; instructions: string | null }
export interface CartItem { id: UUID; product_id: UUID; option_ids: UUID[]; quantity: number; notes: string | null; unit_price_minor: number; line_total_minor: number }
export interface Cart extends Entity { customer_id: UUID; conversation_id: UUID; status: 'active' | 'converted' | 'expired'; items: CartItem[]; subtotal_minor: number; currency: string; expires_at: Timestamp }
export interface OptionSnapshot { name: string; price_delta_minor: number }
export interface OrderItem { id: UUID; product_id: UUID | null; name_snapshot: string; option_snapshots: OptionSnapshot[]; quantity: number; unit_price_minor: number; line_total_minor: number; notes: string | null }
export interface Order extends Entity { customer_id: UUID; conversation_id: UUID; status: OrderStatus; fulfillment: 'pickup' | 'delivery'; items: OrderItem[]; subtotal_minor: number; tax_minor: number; delivery_minor: number; discount_minor: number; total_minor: number; currency: string; address_snapshot: AddressSnapshot | null; quote_expires_at: Timestamp; confirmed_at: Timestamp | null; cancellation_reason: string | null }
export interface Payment extends Entity { order_id: UUID; method: 'cash_on_delivery'; status: 'pending' | 'paid' | 'cancelled'; amount_minor: number; currency: string; paid_at: Timestamp | null }
export interface Conversation extends Entity { customer_id: UUID; status: ConversationStatus; assigned_user_id: UUID | null; last_customer_message_at: Timestamp | null; expires_at: Timestamp; automation_epoch: number }
export interface Message extends Entity { conversation_id: UUID; direction: 'inbound' | 'outbound'; kind: 'text' | 'interactive' | 'location' | 'unsupported'; actor_type: 'customer' | 'bot' | 'human' | 'system'; text: string | null; delivery_status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'unknown' | null }
export interface HumanHandoff extends Entity { conversation_id: UUID; reason: HandoffReason; status: 'pending' | 'active' | 'resolved'; assigned_user_id: UUID | null; resolved_at: Timestamp | null; resolution: string | null }
export interface OpeningInterval { day: number; opens_at: string; closes_at: string }
export interface BusinessSettings { business_id: UUID; version: number; created_at: Timestamp; updated_at: Timestamp; opening_hours: OpeningInterval[]; accepting_orders: boolean; delivery_enabled: boolean; pickup_enabled: boolean; min_order_minor: number; session_ttl_minutes: number; ai_enabled: boolean }
export interface DeliveryZone extends Entity { name: string; polygon_geojson: { type: 'Polygon'; coordinates: number[][][] }; fee_minor: number; min_order_minor: number; priority: number; active: boolean }
export interface Metrics { from: Timestamp; to: Timestamp; orders_confirmed: number; orders_cancelled: number; handoffs_created: number; sales_minor: number; currency: string; generated_at: Timestamp }
export interface Membership { business_id: UUID; role: Role }
export interface Me { user_id: UUID; memberships: Membership[] }
export interface Meta { request_id: UUID }
export interface ApiResponse<T> { data: T; meta: Meta }
export interface Pagination { next_cursor: string | null; has_more: boolean; limit: number }
export interface Page<T> extends ApiResponse<T[]> { pagination: Pagination }
export interface ApiError { error: { code: ErrorCode; message: string; details: { field: string; issue: string }[]; retryable: boolean }; meta: Meta }
export interface CategoryInput { name: string; sort_order: number; active: boolean }
export interface ProductInput { category_id: UUID; name: string; description: string | null; price_minor: number; currency: string; available: boolean; image_url: string | null }
export interface ProductOptionInput { group_key: string; name: string; price_delta_minor: number; required: boolean; min_select: number; max_select: number; available: boolean }
export interface DeliveryZoneInput { name: string; polygon_geojson: DeliveryZone['polygon_geojson']; fee_minor: number; min_order_minor: number; priority: number; active: boolean }
export interface Versioned { expected_version: number }
export type ProductUpdate = Partial<ProductInput> & Versioned;
export type CategoryUpdate = Partial<CategoryInput> & Versioned;
export type ProductOptionUpdate = Partial<ProductOptionInput> & Versioned;
export type DeliveryZoneUpdate = Partial<DeliveryZoneInput> & Versioned;
export interface OrderTransitionInput extends Versioned { action: OrderAction; reason: string | null }
export interface HandoffCreateInput { reason: HandoffReason; context: string | null; expected_conversation_version: number }
export interface HandoffResolveInput extends Versioned { action: 'resume_bot' | 'close'; resolution: string }
export interface HumanMessageInput { text: string; expected_conversation_version: number }
export interface MessageReceipt { outbox_id: UUID; status: 'queued' }
export interface PaymentRecordInput extends Versioned { paid_at: Timestamp; note: string }
export interface BusinessUpdate extends Versioned { name?: string; timezone?: string }
export interface SettingsUpdate extends Versioned { opening_hours?: OpeningInterval[]; accepting_orders?: boolean; delivery_enabled?: boolean; pickup_enabled?: boolean; min_order_minor?: number; session_ttl_minutes?: number; ai_enabled?: boolean }
export interface HandoffClaimInput extends Versioned { assigned_user_id: UUID }
export type DomainEventType = 'order.created' | 'order.status_changed' | 'conversation.updated' | 'message.received' | 'message.delivery_updated' | 'handoff.created' | 'handoff.resolved';
export interface DomainEvent { event_id: UUID; business_id: UUID; type: DomainEventType; resource_id: UUID; resource_version: number; occurred_at: Timestamp; request_id: UUID }
