import { describe, it, expect } from 'vitest';
import { formatMinorToDisplay, minorToDecimal, decimalToMinor } from '../adapters/moneyAdapter';
import { mapDtoOrderToViewModel } from '../adapters/orderAdapter';
import {
  mapDtoConversationToViewModel,
  mapDtoMessageToViewModel,
} from '../adapters/conversationAdapter';
import { mapDtoCustomerToViewModel } from '../adapters/customerAdapter';
import {
  mapDtoCategoryToViewModel,
  mapDtoProductToViewModel,
} from '../adapters/menuAdapter';
import { mapDtoMetricsToViewModel } from '../adapters/metricsAdapter';
import type {
  Order as DTOOrder,
  Conversation as DTOConversation,
  Message as DTOMessage,
  Customer as DTOCustomer,
  Category as DTOCategory,
  Product as DTOProduct,
  Metrics as DTOMetrics,
} from '@agente-ia/shared';

describe('Adapters Suite', () => {
  describe('Money Adapter', () => {
    it('formats minor units to display string without recalculating totals', () => {
      expect(formatMinorToDisplay(1250, 'USD')).toMatch(/\$?\s*12[.,]50/);
      expect(minorToDecimal(1250)).toBe(12.5);
      expect(decimalToMinor(12.5)).toBe(1250);
    });

    it('handles zero and fractional minor units cleanly', () => {
      expect(minorToDecimal(0)).toBe(0);
      expect(minorToDecimal(99)).toBe(0.99);
      expect(decimalToMinor(0.99)).toBe(99);
    });
  });

  describe('Orders Adapter', () => {
    const mockDtoOrder: DTOOrder = {
      id: 'ord-1111-2222-3333-4444',
      business_id: 'biz-0001',
      version: 3,
      created_at: '2026-10-01T12:00:00Z',
      updated_at: '2026-10-01T12:10:00Z',
      customer_id: 'cust-0001',
      conversation_id: 'conv-0001',
      status: 'confirmed',
      fulfillment: 'delivery',
      items: [
        {
          id: 'item-1',
          product_id: 'prod-1',
          name_snapshot: 'Burger Clásica',
          option_snapshots: [{ name: 'Extra Queso', price_delta_minor: 150 }],
          quantity: 2,
          unit_price_minor: 850,
          line_total_minor: 1700,
          notes: 'Sin cebolla',
        },
      ],
      subtotal_minor: 1700,
      tax_minor: 0,
      delivery_minor: 250,
      discount_minor: 0,
      total_minor: 1950,
      currency: 'USD',
      address_snapshot: {
        address_text: 'Av. Amazonas y Colón',
        instructions: 'Timbre 3B',
        latitude: -0.2,
        longitude: -78.5,
      },
      quote_expires_at: '2026-10-01T12:30:00Z',
      confirmed_at: '2026-10-01T12:05:00Z',
      cancellation_reason: null,
    };

    it('maps canonical DTO Order to presentation ViewModel Order preserving versions and money', () => {
      const viewModel = mapDtoOrderToViewModel(mockDtoOrder, {
        name: 'Juan Pérez',
        phone: '+593 999 111 222',
      });

      expect(viewModel.id).toBe('ord-1111-2222-3333-4444');
      expect(viewModel.version).toBe(3);
      expect(viewModel.orderNumber).toBe('#ORD-1111');
      expect(viewModel.customerName).toBe('Juan Pérez');
      expect(viewModel.customerPhone).toBe('+593 999 111 222');
      expect(viewModel.status).toBe('confirmed');
      expect(viewModel.fulfillmentType).toBe('delivery');
      expect(viewModel.subtotal).toBe(17);
      expect(viewModel.deliveryFee).toBe(2.5);
      expect(viewModel.total).toBe(19.5);
      expect(viewModel.items).toHaveLength(1);
      expect(viewModel.items[0].name).toBe('Burger Clásica');
      expect(viewModel.items[0].selectedModifiers).toHaveLength(1);
      expect(viewModel.items[0].selectedModifiers![0].priceDelta).toBe(1.5);
      expect(viewModel.deliveryAddress?.street).toBe('Av. Amazonas y Colón');
      expect(viewModel.deliveryAddress?.reference).toBe('Timbre 3B');
    });
  });

  describe('Conversations Adapter', () => {
    const mockDtoConv: DTOConversation = {
      id: 'conv-001',
      business_id: 'biz-001',
      version: 2,
      created_at: '2026-10-01T10:00:00Z',
      updated_at: '2026-10-01T10:15:00Z',
      customer_id: 'cust-001',
      status: 'human_pending',
      assigned_user_id: null,
      last_customer_message_at: '2026-10-01T10:14:00Z',
      expires_at: '2026-10-02T10:00:00Z',
      automation_epoch: 1,
    };

    const mockDtoMsg: DTOMessage = {
      id: 'msg-001',
      business_id: 'biz-001',
      conversation_id: 'conv-001',
      version: 1,
      created_at: '2026-10-01T10:14:00Z',
      updated_at: '2026-10-01T10:14:00Z',
      direction: 'inbound',
      kind: 'text',
      actor_type: 'customer',
      outbox_id: null,
      text: 'Quiero hablar con un humano por favor',
      delivery_status: 'delivered',
    };

    it('maps DTO Message to safe ViewModel ChatMessage without HTML injection', () => {
      const viewModelMsg = mapDtoMessageToViewModel(mockDtoMsg);
      expect(viewModelMsg.sender).toBe('customer');
      expect(viewModelMsg.content).toBe('Quiero hablar con un humano por favor');
      expect(viewModelMsg.type).toBe('text');
    });

    it('maps DTO Conversation to ViewModel ConversationSummary with human_pending status', () => {
      const summary = mapDtoConversationToViewModel(mockDtoConv, {
        customer: { name: 'Maria Silva', phone_masked: '+593 9** *** 333' },
        lastMessage: mockDtoMsg,
      });

      expect(summary.id).toBe('conv-001');
      expect(summary.version).toBe(2);
      expect(summary.status).toBe('human_pending');
      expect(summary.customerName).toBe('Maria Silva');
      expect(summary.customerPhone).toBe('+593 9** *** 333');
      expect(summary.lastMessageSnippet).toBe('Quiero hablar con un humano por favor');
      expect(summary.unreadCount).toBe(1);
    });
  });

  describe('Customers Adapter', () => {
    it('strictly preserves phone_masked without inventing unmasked PII', () => {
      const mockCustomerDto: DTOCustomer = {
        id: 'cust-100',
        business_id: 'biz-001',
        version: 1,
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-10T00:00:00Z',
        display_name: 'Carlos Mendoza',
        phone_masked: '+593 9** *** 888',
      };

      const customerViewModel = mapDtoCustomerToViewModel(mockCustomerDto, {
        totalOrders: 5,
        totalSpent: 62.5,
      });

      expect(customerViewModel.id).toBe('cust-100');
      expect(customerViewModel.name).toBe('Carlos Mendoza');
      expect(customerViewModel.phone).toBe('+593 9** *** 888');
      expect(customerViewModel.totalOrdersCount).toBe(5);
      expect(customerViewModel.totalSpent).toBe(62.5);
    });
  });

  describe('Menu Adapter', () => {
    it('maps Categories and Products with modifier groups', () => {
      const catDto: DTOCategory = {
        id: 'cat-01',
        business_id: 'biz-01',
        version: 1,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        name: 'Hamburguesas',
        sort_order: 1,
        active: true,
      };

      const prodDto: DTOProduct = {
        id: 'prod-01',
        business_id: 'biz-01',
        category_id: 'cat-01',
        version: 2,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        name: 'Doble Bacon',
        description: 'Doble carne y extra tocino',
        price_minor: 950,
        currency: 'USD',
        available: true,
        image_url: null,
        options: [
          {
            id: 'opt-1',
            product_id: 'prod-01',
            business_id: 'biz-01',
            version: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            group_key: 'salsas',
            name: 'BBQ Ahumada',
            price_delta_minor: 50,
            required: false,
            min_select: 0,
            max_select: 2,
            available: true,
          },
        ],
      };

      const catViewModel = mapDtoCategoryToViewModel(catDto);
      expect(catViewModel.name).toBe('Hamburguesas');
      expect(catViewModel.isActive).toBe(true);

      const prodViewModel = mapDtoProductToViewModel(prodDto, catViewModel.name);
      expect(prodViewModel.name).toBe('Doble Bacon');
      expect(prodViewModel.price).toBe(9.5);
      expect(prodViewModel.modifierGroups).toHaveLength(1);
      expect(prodViewModel.modifierGroups![0].id).toBe('salsas');
      expect(prodViewModel.modifierGroups![0].options[0].priceDelta).toBe(0.5);
    });
  });

  describe('Metrics Adapter', () => {
    it('maps canonical DTO Metrics to DashboardMetrics ViewModel', () => {
      const metricsDto: DTOMetrics = {
        from: '2026-10-01T00:00:00Z',
        to: '2026-10-01T23:59:59Z',
        orders_confirmed: 20,
        orders_cancelled: 2,
        handoffs_created: 3,
        sales_minor: 25000,
        currency: 'USD',
        generated_at: '2026-10-02T00:00:00Z',
      };

      const vm = mapDtoMetricsToViewModel(metricsDto, {
        newOrders: 4,
        inKitchen: 2,
        readyOrDelivering: 3,
      });

      expect(vm.dailySalesTotal).toBe(250);
      expect(vm.completedTodayCount).toBe(20);
      expect(vm.averageTicket).toBe(12.5); // 250 / 20
      expect(vm.newOrdersCount).toBe(4);
      expect(vm.waitingHumanChatsCount).toBe(3);
    });
  });
});
