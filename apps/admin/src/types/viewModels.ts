import type { OrderStatus, ConversationStatus } from '@agente-ia/shared';

export type { OrderStatus, ConversationStatus };

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
  orderNumber: string;
  version?: number;
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
  createdAt: string;
  updatedAt: string;
  estimatedDeliveryTime?: string;
  completedAt?: string;
  cancellationReason?: string;
}

export type MessageSender = 'customer' | 'bot' | 'staff' | 'system';
export type MessageContentType = 'text' | 'image' | 'location' | 'order_summary' | 'internal_note';

export interface ChatMessage {
  id: string;
  conversationId: string;
  sender: MessageSender;
  senderName?: string;
  type: MessageContentType;
  content: string;
  timestamp: string;
  isInternalNote?: boolean;
  orderReferenceId?: string;
}

export interface ConversationSummary {
  id: string;
  version?: number;
  customerPhone: string;
  customerName: string;
  status: ConversationStatus;
  lastMessageSnippet: string;
  lastMessageTime: string;
  unreadCount: number;
  assignedOperatorId?: string;
  assignedOperatorName?: string;
  activeOrderId?: string;
  handoffId?: string;
  handoffRequestedAt?: string;
}

export interface MenuItemCategory {
  id: string;
  version?: number;
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
  version?: number;
  categoryId: string;
  categoryName?: string;
  name: string;
  description: string;
  price: number;
  imageUrl?: string;
  isAvailable: boolean;
  modifierGroups?: ModifierGroup[];
  createdAt: string;
  updatedAt: string;
}

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

export type AgentTone = 'friendly_casual' | 'formal_polite' | 'energetic_youthful' | 'unavailable';

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
  dayOfWeek: number;
  dayName: string;
  isOpen: boolean;
  openTime: string;
  closeTime: string;
}

export interface BusinessSettings {
  name: string;
  legalName?: string;
  supportPhone: string;
  address: string;
  currencySymbol: string;
  isAcceptingOrders: boolean;
  emergencyCloseReason?: string;
  hours: BusinessDayHours[];
}

export interface DeliverySettings {
  maxCoverageRadiusKm: number | null;
  baseDeliveryFee: number | null;
  perKmFee: number | null;
  estimatedPrepTimeMin: number | null;
  estimatedTransitTimeMin: number | null;
}

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
  hour: string;
  orderCount: number;
  totalAmount: number;
}
