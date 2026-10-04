import type { OrderStatus, ConversationStatus } from '@agente-ia/shared';

export type { OrderStatus, ConversationStatus };

export type FulfillmentType = 'delivery' | 'pickup';
export type PaymentStatus = 'pending' | 'paid' | 'cancelled';
export type PaymentMethod = 'cash_on_delivery';

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

export interface OrderPayment {
  id: string;
  orderId: string;
  method: 'cash_on_delivery';
  status: 'pending' | 'paid' | 'cancelled';
  amountMinor: number;
  amount: number;
  currency: string;
  paidAt?: string | null;
  notes?: string | null;
  version?: number;
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
  subtotalMinor?: number;
  deliveryFee: number;
  deliveryMinor?: number;
  discount?: number;
  discountMinor?: number;
  total: number;
  totalMinor?: number;
  currency?: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  payment?: OrderPayment;
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
  handoffReason?: string;
  handoffStatus?: 'pending' | 'active' | 'resolved';
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
  priceDeltaMinor: number;
  priceDelta: number;
  isAvailable: boolean;
  sortOrder: number;
  version?: number;
}

export interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  minSelections: number;
  maxSelections: number;
  sortOrder: number;
  active: boolean;
  version?: number;
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
  priceMinor?: number;
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

export interface DeliveryZone {
  id: string;
  version?: number;
  name: string;
  feeMinor: number;
  fee: number;
  minOrderMinor: number;
  minOrder: number;
  priority: number;
  active: boolean;
  polygonGeojson?: {
    type: 'Polygon';
    coordinates: number[][][];
  };
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
  version?: number;
  name: string;
  legalName?: string;
  supportPhone: string;
  address: string;
  currencySymbol: string;
  isAcceptingOrders: boolean;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  minOrderMinor: number;
  minOrder: number;
  sessionTtlMinutes: number;
  aiEnabled: boolean;
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
