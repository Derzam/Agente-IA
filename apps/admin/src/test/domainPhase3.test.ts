import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  mapDtoProductOptionsToModifierGroups,
  mapDtoProductToViewModel,
} from '../adapters/menuAdapter';
import { mapDtoDeliveryZoneToViewModel } from '../adapters/deliveryZoneAdapter';
import { mapDtoOrderToViewModel } from '../adapters/orderAdapter';
import { deliveryZoneService } from '../services/deliveryZoneService';
import { orderService } from '../services/orderService';
import { menuService, syncProductModifiers } from '../services/menuService';
import { endpoints } from '../api/endpoints';
import { VERSION_CONFLICT_MESSAGE } from '../api/types';
import type {
  ProductOption as DTOProductOption,
  Product as DTOProduct,
  DeliveryZone as DTODeliveryZone,
  Order as DTOOrder,
  Payment as DTOPayment,
} from '@agente-ia/shared';

describe('Phase 3 Domain Test Suite', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  describe('Canonical Modifiers Hierarchy (Product -> Groups -> Options)', () => {
    const mockDtoOptions: DTOProductOption[] = [
      {
        id: 'opt-tamano-normal',
        product_id: 'prod-burger-1',
        business_id: 'biz-01',
        version: 1,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
        group_key: 'tamano',
        name: 'Normal',
        price_delta_minor: 0,
        required: true,
        min_select: 1,
        max_select: 1,
        available: true,
      },
      {
        id: 'opt-tamano-doble',
        product_id: 'prod-burger-1',
        business_id: 'biz-01',
        version: 1,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
        group_key: 'tamano',
        name: 'Doble',
        price_delta_minor: 200,
        required: true,
        min_select: 1,
        max_select: 1,
        available: true,
      },
      {
        id: 'opt-extras-queso',
        product_id: 'prod-burger-1',
        business_id: 'biz-01',
        version: 1,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
        group_key: 'extras',
        name: 'Queso',
        price_delta_minor: 50,
        required: false,
        min_select: 0,
        max_select: 5,
        available: true,
      },
      {
        id: 'opt-extras-tocino',
        product_id: 'prod-burger-1',
        business_id: 'biz-01',
        version: 2,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
        group_key: 'extras',
        name: 'Tocino',
        price_delta_minor: 100,
        required: false,
        min_select: 0,
        max_select: 5,
        available: false,
      },
    ];

    it('transforms flat DTO options into hierarchical ModifierGroups with nested ModifierOptions', () => {
      const groups = mapDtoProductOptionsToModifierGroups(mockDtoOptions);

      expect(groups).toHaveLength(2);

      const tamanoGroup = groups.find((g) => g.id === 'tamano');
      expect(tamanoGroup).toBeDefined();
      expect(tamanoGroup!.name).toBe('Tamano');
      expect(tamanoGroup!.required).toBe(true);
      expect(tamanoGroup!.minSelect).toBe(1);
      expect(tamanoGroup!.maxSelect).toBe(1);
      expect(tamanoGroup!.options).toHaveLength(2);

      const normalOpt = tamanoGroup!.options.find((o) => o.id === 'opt-tamano-normal');
      expect(normalOpt).toBeDefined();
      expect(normalOpt!.name).toBe('Normal');
      expect(normalOpt!.priceDeltaMinor).toBe(0);
      expect(normalOpt!.priceDelta).toBe(0);
      expect(normalOpt!.isAvailable).toBe(true);

      const dobleOpt = tamanoGroup!.options.find((o) => o.id === 'opt-tamano-doble');
      expect(dobleOpt).toBeDefined();
      expect(dobleOpt!.priceDeltaMinor).toBe(200);
      expect(dobleOpt!.priceDelta).toBe(2);

      const extrasGroup = groups.find((g) => g.id === 'extras');
      expect(extrasGroup).toBeDefined();
      expect(extrasGroup!.required).toBe(false);
      expect(extrasGroup!.minSelect).toBe(0);
      expect(extrasGroup!.maxSelect).toBe(5);
      expect(extrasGroup!.options).toHaveLength(2);

      const tocinoOpt = extrasGroup!.options.find((o) => o.id === 'opt-extras-tocino');
      expect(tocinoOpt!.isAvailable).toBe(false);
      expect(tocinoOpt!.priceDeltaMinor).toBe(100);
      expect(tocinoOpt!.priceDelta).toBe(1);
    });

    it('integrates modifiers into Product ViewModel without mixing base price', () => {
      const prodDto: DTOProduct = {
        id: 'prod-001',
        business_id: 'biz-01',
        category_id: 'cat-01',
        version: 3,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
        name: 'Hamburguesa Especial',
        description: 'Deliciosa carne con queso',
        price_minor: 850,
        currency: 'USD',
        available: true,
        image_url: 'https://example.com/burger.jpg',
        options: mockDtoOptions,
      };

      const vm = mapDtoProductToViewModel(prodDto, 'Burgers');
      expect(vm.priceMinor).toBe(850);
      expect(vm.price).toBe(8.5);
      expect(vm.modifierGroups).toHaveLength(2);
      expect(vm.modifierGroups![0].options[1].priceDelta).toBe(2);
    });
  });

  describe('Canonical real API modifier persistence', () => {
    it('updates a group and creates, updates and deletes its canonical options', async () => {
      const current = [{
        id: 'grp-extras',
        business_id: 'biz-1',
        product_id: 'prod-1',
        name: 'Extras',
        required: false,
        min_select: 0,
        max_select: 2,
        sort_order: 1,
        active: true,
        version: 4,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
        options: [
          {
            id: 'existing-keep',
            business_id: 'biz-1',
            modifier_group_id: 'grp-extras',
            name: 'Queso',
            price_delta_minor: 50,
            available: true,
            sort_order: 1,
            version: 3,
            created_at: '2026-10-01T00:00:00Z',
            updated_at: '2026-10-01T00:00:00Z',
          },
          {
            id: 'existing-remove',
            business_id: 'biz-1',
            modifier_group_id: 'grp-extras',
            name: 'Tocino',
            price_delta_minor: 100,
            available: true,
            sort_order: 2,
            version: 2,
            created_at: '2026-10-01T00:00:00Z',
            updated_at: '2026-10-01T00:00:00Z',
          },
        ],
      }];

      const groups = [{
        id: 'grp-extras', name: 'Extras', required: false, minSelect: 0, maxSelect: 3,
        minSelections: 0, maxSelections: 3, sortOrder: 2, active: true, version: 4,
        options: [
          { id: 'existing-keep', name: 'Queso extra', priceDeltaMinor: 75, priceDelta: 0.75, isAvailable: true, sortOrder: 1, version: 3 },
          { id: 'temp-new', name: 'Huevo', priceDeltaMinor: 80, priceDelta: 0.8, isAvailable: true, sortOrder: 2, version: 1 },
        ],
      }];

      const updateGroup = vi.spyOn(endpoints, 'updateModifierGroup').mockResolvedValue({
        ...current[0],
        max_select: 3,
        sort_order: 2,
        version: 5,
      });
      const updateOption = vi.spyOn(endpoints, 'updateModifierOption').mockResolvedValue(current[0].options[0]);
      const createOption = vi.spyOn(endpoints, 'createModifierOption').mockResolvedValue(current[0].options[0]);
      const deleteOption = vi.spyOn(endpoints, 'deleteModifierOption').mockResolvedValue(undefined);
      const deleteGroup = vi.spyOn(endpoints, 'deleteModifierGroup').mockResolvedValue(undefined);

      await syncProductModifiers('prod-1', groups, current);

      expect(updateGroup).toHaveBeenCalledWith(
        'prod-1',
        'grp-extras',
        expect.objectContaining({
          name: 'Extras',
          min_select: 0,
          max_select: 3,
          sort_order: 2,
          active: true,
          expected_version: 4,
        }),
        expect.any(String),
        undefined,
        undefined
      );
      expect(updateOption).toHaveBeenCalledWith(
        'prod-1',
        'grp-extras',
        'existing-keep',
        expect.objectContaining({
          name: 'Queso extra',
          price_delta_minor: 75,
          sort_order: 1,
          expected_version: 3,
        }),
        expect.any(String),
        undefined,
        undefined
      );
      expect(createOption).toHaveBeenCalledWith(
        'prod-1',
        'grp-extras',
        expect.objectContaining({ name: 'Huevo', price_delta_minor: 80, sort_order: 2 }),
        expect.any(String),
        undefined,
        undefined
      );
      expect(deleteOption).toHaveBeenCalledWith(
        'prod-1',
        'grp-extras',
        'existing-remove',
        2,
        expect.any(String),
        undefined,
        undefined
      );
      expect(deleteGroup).not.toHaveBeenCalled();
    });

    it('creates an independent inactive group without rewriting option availability', async () => {
      const groups = [{
        id: 'temp-salsas', name: 'Salsas', required: false, minSelect: 0, maxSelect: 1,
        minSelections: 0, maxSelections: 1, sortOrder: 1, active: false, version: 1,
        options: [
          { id: 'new-salsa', name: 'BBQ', priceDeltaMinor: 0, priceDelta: 0, isAvailable: true, sortOrder: 1, version: 1 },
        ],
      }];

      const createGroup = vi.spyOn(endpoints, 'createModifierGroup').mockResolvedValue({
        id: 'grp-salsas',
        business_id: 'biz-1',
        product_id: 'prod-1',
        name: 'Salsas',
        required: false,
        min_select: 0,
        max_select: 1,
        sort_order: 1,
        active: false,
        version: 1,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      });
      const createOption = vi.spyOn(endpoints, 'createModifierOption').mockResolvedValue({
        id: 'opt-bbq',
        business_id: 'biz-1',
        modifier_group_id: 'grp-salsas',
        name: 'BBQ',
        price_delta_minor: 0,
        available: true,
        sort_order: 1,
        version: 1,
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      });

      await syncProductModifiers('prod-1', groups, []);

      expect(createGroup.mock.calls[0][1]).toMatchObject({ name: 'Salsas', active: false });
      expect(createOption.mock.calls[0][2]).toMatchObject({ name: 'BBQ', available: true });
    });
  });

  describe('Delivery Zones Adapter and Service', () => {
    const mockZoneDto: DTODeliveryZone = {
      id: 'zone-1',
      business_id: 'biz-01',
      name: 'Zona Centro',
      fee_minor: 250,
      min_order_minor: 1000,
      priority: 1,
      active: true,
      polygon_geojson: {
        type: 'Polygon',
        coordinates: [
          [
            [-74.006, 40.7128],
            [-74.005, 40.7138],
            [-74.004, 40.7128],
            [-74.006, 40.7128],
          ],
        ],
      },
      version: 1,
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    };

    it('maps DeliveryZone DTO to ViewModel converting minor amounts safely', () => {
      const vm = mapDtoDeliveryZoneToViewModel(mockZoneDto);
      expect(vm.id).toBe('zone-1');
      expect(vm.name).toBe('Zona Centro');
      expect(vm.feeMinor).toBe(250);
      expect(vm.fee).toBe(2.5);
      expect(vm.minOrderMinor).toBe(1000);
      expect(vm.minOrder).toBe(10);
      expect(vm.priority).toBe(1);
      expect(vm.active).toBe(true);
      expect(vm.polygonGeojson).toEqual(mockZoneDto.polygon_geojson);
      expect(vm.version).toBe(1);
    });

    it('supports CRUD and toggleActive in deliveryZoneService (mock mode)', async () => {
      const initialZones = await deliveryZoneService.getDeliveryZones();
      expect(initialZones.length).toBeGreaterThan(0);

      // Create
      const newZone = await deliveryZoneService.createDeliveryZone({
        name: 'Zona Express Sur',
        fee: 3,
        feeMinor: 300,
        minOrder: 12,
        minOrderMinor: 1200,
        priority: 5,
        active: true,
      });
      expect(newZone.name).toBe('Zona Express Sur');
      expect(newZone.fee).toBe(3);
      expect(newZone.minOrder).toBe(12);

      // Toggle active
      const toggled = await deliveryZoneService.toggleActive(
        newZone.id,
        false,
        newZone.version,
      );
      expect(toggled.active).toBe(false);
      expect(toggled.version).toBe((newZone.version || 1) + 1);

      // Update
      const updated = await deliveryZoneService.updateDeliveryZone({
        ...newZone,
        fee: 4,
        feeMinor: 400,
        minOrder: 15,
        minOrderMinor: 1500,
        version: toggled.version,
      });
      expect(updated.feeMinor).toBe(400);
      expect(updated.fee).toBe(4);
      expect(updated.minOrder).toBe(15);

      // Delete
      await deliveryZoneService.deleteDeliveryZone(newZone.id, updated.version);
      const afterDelete = await deliveryZoneService.getDeliveryZones();
      expect(afterDelete.find((z) => z.id === newZone.id)).toBeUndefined();
    });
  });

  describe('Cash on Delivery Payments & Snapshots', () => {
    const mockPaymentDto: DTOPayment = {
      id: 'pay-01',
      business_id: 'biz-01',
      order_id: 'ord-cash-01',
      version: 1,
      created_at: '2026-10-01T12:00:00Z',
      updated_at: '2026-10-01T12:00:00Z',
      method: 'cash_on_delivery',
      status: 'pending',
      amount_minor: 1400,
      currency: 'USD',
      paid_at: null,
    };

    const mockOrderDto: DTOOrder = {
      id: 'ord-cash-01',
      business_id: 'biz-01',
      version: 2,
      created_at: '2026-10-01T12:00:00Z',
      updated_at: '2026-10-01T12:10:00Z',
      customer_id: 'cust-01',
      conversation_id: 'conv-01',
      status: 'accepted',
      fulfillment: 'delivery',
      subtotal_minor: 1200,
      tax_minor: 0,
      delivery_minor: 200,
      discount_minor: 0,
      total_minor: 1400,
      currency: 'USD',
      address_snapshot: null,
      quote_expires_at: '2026-10-01T13:00:00Z',
      confirmed_at: '2026-10-01T12:05:00Z',
      cancellation_reason: null,
      items: [
        {
          id: 'item-1',
          product_id: 'prod-01',
          name_snapshot: 'Hamburguesa Especial',
          option_snapshots: [
            { name: 'Doble', price_delta_minor: 200 },
            { name: 'Extra Queso', price_delta_minor: 50 },
          ],
          quantity: 1,
          unit_price_minor: 850,
          line_total_minor: 1100,
          notes: 'Bien cocida',
        },
      ],
    };

    it('maps Order DTO with Cash on Delivery payment correctly', () => {
      const vm = mapDtoOrderToViewModel(mockOrderDto, undefined, mockPaymentDto);
      expect(vm.id).toBe('ord-cash-01');
      expect(vm.subtotalMinor).toBe(1200);
      expect(vm.subtotal).toBe(12);
      expect(vm.deliveryMinor).toBe(200);
      expect(vm.deliveryFee).toBe(2);
      expect(vm.totalMinor).toBe(1400);
      expect(vm.total).toBe(14);

      expect(vm.payment).toBeDefined();
      expect(vm.payment!.method).toBe('cash_on_delivery');
      expect(vm.payment!.status).toBe('pending');
      expect(vm.payment!.amountMinor).toBe(1400);
      expect(vm.payment!.amount).toBe(14);
      expect(vm.payment!.paidAt).toBeNull();

      // Check item snapshot preserved
      expect(vm.items[0].name).toBe('Hamburguesa Especial');
      expect(vm.items[0].selectedModifiers).toHaveLength(2);
      expect(vm.items[0].selectedModifiers![0].name).toBe('Doble');
      expect(vm.items[0].selectedModifiers![0].priceDelta).toBe(2);
    });

    it('records cash payment using orderService with expected_version and changes payment status to paid', async () => {
      const initialOrders = await orderService.getOrders();
      const orderWithCash = initialOrders.find((o) => o.payment && o.payment.status === 'pending');
      expect(orderWithCash).toBeDefined();
      const target = orderWithCash!;

      const updated = await orderService.recordCashPayment(
        target.id,
        target.version || 1,
        'Cobrado en efectivo en puerta',
        new Date().toISOString(),
      );

      expect(updated.payment).toBeDefined();
      expect(updated.payment!.status).toBe('paid');
      expect(updated.payment!.notes).toBe('Cobrado en efectivo en puerta');
      expect(updated.version).toBe((target.version || 1) + 1);
    });
  });

  describe('Optimistic Concurrency & 409 Conflict Message', () => {
    it('uses the exact canonical 409 conflict message', () => {
      expect(VERSION_CONFLICT_MESSAGE).toBe(
        'El registro cambió. Actualiza la información antes de continuar.',
      );
    });
  });

  describe('Menu Service Category & Product Operations', () => {
    it('creates, updates and logically deletes a category', async () => {
      const created = await menuService.createCategory({
        name: 'Postres Artesanales',
        sortOrder: 99,
        isActive: true,
      });
      expect(created.name).toBe('Postres Artesanales');
      expect(created.isActive).toBe(true);

      const updated = await menuService.updateCategory({
        ...created,
        name: 'Postres y Dulces',
      });
      expect(updated.name).toBe('Postres y Dulces');

      await menuService.deleteCategory(created.id, updated.version);
      const categories = await menuService.getCategories();
      const found = categories.find((c) => c.id === created.id);
      expect(found).toBeUndefined();
    });
  });
});
