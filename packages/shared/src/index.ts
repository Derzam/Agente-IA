/**
 * Shared Type Definitions and Contracts
 * Agente-IA: WhatsApp Food Restaurant AI Assistant
 * Coordination between Codex (Backend) and Antigravity (Frontend/UX)
 */

// ==========================================
// 1. ORDER & FULFILLMENT TYPES
// ==========================================

export type OrderStatus =
  | 'pending'           // Pedido confirmado por cliente, pendiente de ingresar a cocina
  | 'in_kitchen'        // En preparación en cocina
  | 'out_for_delivery'  // En ruta con repartidor
  | 'ready_for_pickup'  // Listo para retirar en mostrador
  | 'delivered'         // Completado y entregado
  | 'cancelled';        // Anulado

export type FulfillmentType = 'delivery' | 'pickup';

export type PaymentStatus = 'pending' | 'paid' | 'pay_on_delivery' | 'failed';

export type PaymentMethod = 'cash' | 'card_on_delivery' | 'bank_transfer' | 'online_link';

export interface OrderModifier {
  id: string;
  name: string;
  priceDelta: number;
}

export interface OrderItem {
  id: string;
  menuItemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  selectedModifiers?: OrderModifier[];
  notes?: string;
}

export interface OrderDeliveryAddress {
  street: string;
  number?: string;
  apartmentOrFloor?: string;
  reference?: string;
  latitude?: number;
  longitude?: number;
}

export interface Order {
  id: string;
  orderNumber: string;        // ej. "#BS-1082"
  customerId: string;
  customerName: string;
  customerPhone: string;
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  deliveryAddress?: OrderDeliveryAddress;
  kitchenNotes?: string;
  createdAt: string;          // ISO Date
  updatedAt: string;
  estimatedDeliveryTime?: string;
  completedAt?: string;
  cancellationReason?: string;
}

// ==========================================
// 2. CONVERSATION & CHAT TYPES
// ==========================================

export type ConversationStatus =
  | 'bot_active'     // IA respondiendo automáticamente
  | 'waiting_human'  // Cliente en espera de atención humana (Alerta activa)
  | 'human_active'   // Operador del panel atendiendo manualmente
  | 'resolved';      // Conversación cerrada

export type MessageSender = 'customer' | 'bot' | 'staff' | 'system';

export type MessageContentType = 'text' | 'image' | 'location' | 'order_summary' | 'internal_note';

export interface ChatMessage {
  id: string;
  conversationId: string;
  sender: MessageSender;
  senderName?: string;
  type: MessageContentType;
  content: string;
  timestamp: string;          // ISO Date
  isInternalNote?: boolean;   // Visible solo en panel, no en WhatsApp
  orderReferenceId?: string;
}

export interface ConversationSummary {
  id: string;
  customerPhone: string;
  customerName: string;
  status: ConversationStatus;
  lastMessageSnippet: string;
  lastMessageTime: string;    // ISO Date
  unreadCount: number;
  assignedOperatorId?: string;
  assignedOperatorName?: string;
  activeOrderId?: string;
  handoffRequestedAt?: string;
}

// ==========================================
// 3. MENU & CATALOG TYPES
// ==========================================

export interface MenuItemCategory {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
}

export interface ModifierOption {
  id: string;
  name: string;
  priceDelta: number;
  isAvailable: boolean;
}

export interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  options: ModifierOption[];
}

export interface MenuItem {
  id: string;
  categoryId: string;
  categoryName?: string;
  name: string;
  description: string;
  price: number;
  imageUrl?: string;
  isAvailable: boolean;       // Instant stock switch
  modifierGroups?: ModifierGroup[];
  createdAt: string;
  updatedAt: string;
}

// ==========================================
// 4. CUSTOMER TYPES
// ==========================================

export interface Customer {
  id: string;
  phone: string;
  name: string;
  totalOrdersCount: number;
  totalSpent: number;
  firstInteractionAt: string;
  lastInteractionAt: string;
  defaultDeliveryAddress?: OrderDeliveryAddress;
  isVip?: boolean;
  notes?: string;
}

// ==========================================
// 5. SETTINGS & AGENT CONFIGURATION TYPES
// ==========================================

export type AgentTone = 'friendly_casual' | 'formal_polite' | 'energetic_youthful';

export interface AgentConfig {
  isEnabled: boolean;
  assistantName: string;
  tone: AgentTone;
  welcomeGreeting: string;
  outsideHoursMessage: string;
  orderConfirmationMessage: string;
  handoffToHumanMessage: string;
  handoffKeywords: string[];
  systemDirectives: string;
  prohibitedTopics: string[];
}

export interface BusinessDayHours {
  dayOfWeek: number;          // 0: Domingo, 1: Lunes, ..., 6: Sábado
  dayName: string;
  isOpen: boolean;
  openTime: string;           // "12:00"
  closeTime: string;          // "23:00"
}

export interface BusinessSettings {
  name: string;
  legalName?: string;
  supportPhone: string;
  address: string;
  currencySymbol: string;     // "$", "S/", etc.
  isAcceptingOrders: boolean; // Emergency stop
  emergencyCloseReason?: string;
  hours: BusinessDayHours[];
}

export interface DeliverySettings {
  maxCoverageRadiusKm: number;
  baseDeliveryFee: number;
  perKmFee: number;
  estimatedPrepTimeMin: number;
  estimatedTransitTimeMin: number;
}

// ==========================================
// 6. DASHBOARD & METRICS TYPES
// ==========================================

export interface TopSellingItem {
  id: string;
  name: string;
  quantitySoldToday: number;
  revenueToday: number;
}

export interface DashboardMetrics {
  newOrdersCount: number;
  inKitchenCount: number;
  readyOrDeliveringCount: number;
  completedTodayCount: number;
  waitingHumanChatsCount: number;
  dailySalesTotal: number;
  averageTicket: number;
  topSellingItems: TopSellingItem[];
}

export interface HourlySalesData {
  hour: string;               // "12:00", "13:00"
  orderCount: number;
  totalAmount: number;
}

// ==========================================
// 7. API ENVELOPE TYPES
// ==========================================

export interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
