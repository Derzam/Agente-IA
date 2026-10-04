import type { DeliveryZone as DTODeliveryZone } from '@agente-ia/shared';
import type { DeliveryZone as ViewModelDeliveryZone } from '@/types/viewModels';
import { minorToDecimal } from './moneyAdapter';

/**
 * Maps DTO DeliveryZone to presentation ViewModel DeliveryZone.
 * Amounts are converted to decimals for UI display while minor units are preserved.
 */
export function mapDtoDeliveryZoneToViewModel(dto: DTODeliveryZone): ViewModelDeliveryZone {
  return {
    id: dto.id,
    version: dto.version,
    name: dto.name,
    feeMinor: dto.fee_minor,
    fee: minorToDecimal(dto.fee_minor),
    minOrderMinor: dto.min_order_minor,
    minOrder: minorToDecimal(dto.min_order_minor),
    priority: dto.priority,
    active: dto.active,
    polygonGeojson: dto.polygon_geojson,
  };
}
