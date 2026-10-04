import type { DeliveryZone } from '@/types/viewModels';
import { mockDeliveryZones } from '@/mocks/mockData';
import { USE_MOCK_DATA, newIdempotencyKey } from './apiClient';
import { endpoints } from '@/api/endpoints';
import { mapDtoDeliveryZoneToViewModel } from '@/adapters/deliveryZoneAdapter';
import { decimalToMinor, minorToDecimal } from '@/adapters/moneyAdapter';
import type { RequestOptions } from '@/api/types';

let localZones: DeliveryZone[] = [...mockDeliveryZones];

export const deliveryZoneService = {
  async getDeliveryZones(options?: RequestOptions): Promise<DeliveryZone[]> {
    if (USE_MOCK_DATA) {
      return Promise.resolve([...localZones].sort((a, b) => a.priority - b.priority));
    }

    const dtoList = await endpoints.getDeliveryZones(undefined, options);
    return dtoList.map(mapDtoDeliveryZoneToViewModel);
  },

  async createDeliveryZone(
    zone: Omit<DeliveryZone, 'id' | 'version'>,
    idempotencyKey?: string,
    options?: RequestOptions
  ): Promise<DeliveryZone> {
    const key = idempotencyKey || newIdempotencyKey();

    if (USE_MOCK_DATA) {
      const feeMinor = zone.feeMinor ?? (zone.fee !== undefined ? decimalToMinor(zone.fee) : 0);
      const fee = zone.fee ?? minorToDecimal(feeMinor);
      const minOrderMinor = zone.minOrderMinor ?? (zone.minOrder !== undefined ? decimalToMinor(zone.minOrder) : 0);
      const minOrder = zone.minOrder ?? minorToDecimal(minOrderMinor);
      const created: DeliveryZone = {
        ...zone,
        id: `zone-${Date.now()}`,
        version: 1,
        feeMinor,
        fee,
        minOrderMinor,
        minOrder,
      };
      localZones.push(created);
      return Promise.resolve(created);
    }

    const createdDto = await endpoints.createDeliveryZone(
      {
        name: zone.name,
        polygon_geojson: zone.polygonGeojson || {
          type: 'Polygon',
          coordinates: [
            [
              [-77.035, -12.122],
              [-77.028, -12.12],
              [-77.025, -12.128],
              [-77.033, -12.13],
              [-77.035, -12.122],
            ],
          ],
        },
        fee_minor: zone.feeMinor ?? decimalToMinor(zone.fee),
        min_order_minor: zone.minOrderMinor ?? decimalToMinor(zone.minOrder),
        priority: zone.priority,
        active: zone.active,
      },
      key,
      undefined,
      options
    );

    return mapDtoDeliveryZoneToViewModel(createdDto);
  },

  async updateDeliveryZone(
    zone: DeliveryZone,
    idempotencyKey?: string,
    options?: RequestOptions
  ): Promise<DeliveryZone> {
    const key = idempotencyKey || newIdempotencyKey();

    if (USE_MOCK_DATA) {
      const index = localZones.findIndex((z) => z.id === zone.id);
      if (index === -1) throw new Error('Zona de entrega no encontrada');
      const prev = localZones[index];
      const feeMinor = zone.feeMinor ?? (zone.fee !== undefined ? decimalToMinor(zone.fee) : prev.feeMinor);
      const fee = zone.fee ?? minorToDecimal(feeMinor);
      const minOrderMinor = zone.minOrderMinor ?? (zone.minOrder !== undefined ? decimalToMinor(zone.minOrder) : prev.minOrderMinor);
      const minOrder = zone.minOrder ?? minorToDecimal(minOrderMinor);
      const updated: DeliveryZone = {
        ...prev,
        ...zone,
        version: (zone.version || prev.version || 1) + 1,
        feeMinor,
        fee,
        minOrderMinor,
        minOrder,
      };
      localZones[index] = updated;
      return Promise.resolve(updated);
    }

    const updatedDto = await endpoints.updateDeliveryZone(
      zone.id,
      {
        name: zone.name,
        fee_minor: zone.feeMinor ?? decimalToMinor(zone.fee),
        min_order_minor: zone.minOrderMinor ?? decimalToMinor(zone.minOrder),
        priority: zone.priority,
        active: zone.active,
        expected_version: zone.version || 1,
      },
      key,
      undefined,
      options
    );

    return mapDtoDeliveryZoneToViewModel(updatedDto);
  },

  async deleteDeliveryZone(
    zoneId: string,
    expectedVersion = 1,
    idempotencyKey?: string,
    options?: RequestOptions
  ): Promise<void> {
    const key = idempotencyKey || newIdempotencyKey();

    if (USE_MOCK_DATA) {
      localZones = localZones.filter((z) => z.id !== zoneId);
      return Promise.resolve();
    }

    await endpoints.deleteDeliveryZone(zoneId, expectedVersion, key, undefined, options);
  },

  async toggleActive(
    zoneId: string,
    active: boolean,
    expectedVersion = 1,
    idempotencyKey?: string,
    options?: RequestOptions
  ): Promise<DeliveryZone> {
    const key = idempotencyKey || newIdempotencyKey();

    if (USE_MOCK_DATA) {
      const index = localZones.findIndex((z) => z.id === zoneId);
      if (index === -1) throw new Error('Zona de entrega no encontrada');
      const updated: DeliveryZone = {
        ...localZones[index],
        active,
        version: (localZones[index].version || 1) + 1,
      };
      localZones[index] = updated;
      return Promise.resolve(updated);
    }

    const updatedDto = await endpoints.updateDeliveryZone(
      zoneId,
      {
        active,
        expected_version: expectedVersion,
      },
      key,
      undefined,
      options
    );

    return mapDtoDeliveryZoneToViewModel(updatedDto);
  },
};
