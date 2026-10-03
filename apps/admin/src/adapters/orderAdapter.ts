import type {
  Order as DTOOrder,
  OrderItem as DTOOrderItem,
  OrderStatus,
  OrderAction,
  Role,
} from '@agente-ia/shared';
import type {
  Order as ViewModelOrder,
  OrderItem as ViewModelOrderItem,
  OrderDeliveryAddress,
  FulfillmentType,
} from '@/types/viewModels';
import { minorToDecimal } from './moneyAdapter';

/**
 * Maps DTO OrderItem to ViewModel OrderItem.
 * Displays amounts in decimal based on *_minor values from backend.
 */
export function mapDtoOrderItemToViewModel(dto: DTOOrderItem): ViewModelOrderItem {
  return {
    id: dto.id,
    menuItemId: dto.product_id || dto.id,
    name: dto.name_snapshot,
    quantity: dto.quantity,
    unitPrice: minorToDecimal(dto.unit_price_minor),
    subtotal: minorToDecimal(dto.line_total_minor),
    selectedModifiers: dto.option_snapshots.map((opt, i) => ({
      id: `${dto.id}-mod-${i}`,
      name: opt.name,
      priceDelta: minorToDecimal(opt.price_delta_minor),
    })),
    notes: dto.notes || undefined,
  };
}

/**
 * Maps DTO AddressSnapshot to ViewModel OrderDeliveryAddress
 */
export function mapAddressSnapshotToViewModel(
  snapshot: DTOOrder['address_snapshot']
): OrderDeliveryAddress | undefined {
  if (!snapshot) return undefined;
  return {
    street: snapshot.address_text,
    reference: snapshot.instructions || undefined,
    latitude: snapshot.latitude ?? undefined,
    longitude: snapshot.longitude ?? undefined,
  };
}

/**
 * Maps canonical DTO Order to presentation ViewModel Order.
 * Preserves backend version and authoritative totals.
 */
export function mapDtoOrderToViewModel(dto: DTOOrder, customerLookup?: { name?: string; phone?: string }): ViewModelOrder {
  return {
    id: dto.id,
    orderNumber: `#${dto.id.slice(0, 8).toUpperCase()}`,
    version: dto.version,
    customerId: dto.customer_id,
    customerName: customerLookup?.name || 'Cliente WhatsApp',
    customerPhone: customerLookup?.phone || '',
    status: dto.status,
    fulfillmentType: dto.fulfillment as FulfillmentType,
    items: dto.items.map(mapDtoOrderItemToViewModel),
    subtotal: minorToDecimal(dto.subtotal_minor),
    deliveryFee: minorToDecimal(dto.delivery_minor),
    total: minorToDecimal(dto.total_minor),
    paymentMethod: 'cash',
    paymentStatus: dto.status === 'delivered' ? 'paid' : 'pending',
    deliveryAddress: mapAddressSnapshotToViewModel(dto.address_snapshot),
    kitchenNotes: dto.items.map((i) => i.notes).filter(Boolean).join(' | ') || undefined,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    completedAt: dto.status === 'delivered' ? dto.updated_at : undefined,
    cancellationReason: dto.cancellation_reason || undefined,
  };
}

export interface OrderAvailableActions {
  canAccept: boolean;
  canStartPreparation: boolean;
  canMarkReady: boolean;
  canDispatch: boolean;
  canComplete: boolean;
  canCancel: boolean;
  validActions: OrderAction[];
}

/**
 * Calculates strictly authorized actions according to canonical Order Lifecycle:
 * - confirmed -> accept
 * - accepted -> start_preparation
 * - preparing -> mark_ready
 * - ready (delivery) -> dispatch
 * - ready (pickup) -> complete
 * - out_for_delivery -> complete
 * - cancel allowed per role matrix (operator on confirmed, manager/owner on in-progress)
 */
export function getAvailableOrderActions(
  status: OrderStatus,
  fulfillment: 'pickup' | 'delivery' | FulfillmentType,
  role: Role = 'operator'
): OrderAvailableActions {
  const isManagerOrOwner = role === 'manager' || role === 'owner';

  const canAccept = status === 'confirmed';
  const canStartPreparation = status === 'accepted';
  const canMarkReady = status === 'preparing';
  const canDispatch = status === 'ready' && fulfillment === 'delivery';
  const canComplete =
    (status === 'ready' && fulfillment === 'pickup') || status === 'out_for_delivery';

  let canCancel = false;
  if (status === 'awaiting_confirmation' || status === 'confirmed') {
    canCancel = true;
  } else if (
    isManagerOrOwner &&
    (status === 'accepted' || status === 'preparing' || status === 'ready' || status === 'out_for_delivery')
  ) {
    canCancel = true;
  }

  const validActions: OrderAction[] = [];
  if (canAccept) validActions.push('accept');
  if (canStartPreparation) validActions.push('start_preparation');
  if (canMarkReady) validActions.push('mark_ready');
  if (canDispatch) validActions.push('dispatch');
  if (canComplete) validActions.push('complete');
  if (canCancel) validActions.push('cancel');

  return {
    canAccept,
    canStartPreparation,
    canMarkReady,
    canDispatch,
    canComplete,
    canCancel,
    validActions,
  };
}
