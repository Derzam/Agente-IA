import type {
  Category as DTOCategory,
  Product as DTOProduct,
  ProductOption as DTOProductOption,
} from '@agente-ia/shared';
import type {
  MenuItemCategory as ViewModelCategory,
  MenuItem as ViewModelMenuItem,
  ModifierGroup as ViewModelModifierGroup,
  ModifierOption as ViewModelModifierOption,
} from '@/types/viewModels';
import { minorToDecimal } from './moneyAdapter';

/**
 * Maps DTO Category to ViewModel MenuItemCategory
 */
export function mapDtoCategoryToViewModel(dto: DTOCategory): ViewModelCategory {
  return {
    id: dto.id,
    version: dto.version,
    name: dto.name,
    slug: dto.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    sortOrder: dto.sort_order,
    isActive: dto.active,
  };
}

/**
 * Groups flat DTO ProductOption items into UI ModifierGroups
 */
export function mapDtoProductOptionsToModifierGroups(
  options: DTOProductOption[] = []
): ViewModelModifierGroup[] {
  const groupsMap = new Map<string, ViewModelModifierGroup>();
  let groupSortIndex = 0;

  for (const opt of options) {
    const groupKey = opt.group_key || 'general';
    if (!groupsMap.has(groupKey)) {
      groupSortIndex += 1;
      groupsMap.set(groupKey, {
        id: groupKey,
        name: groupKey.charAt(0).toUpperCase() + groupKey.slice(1).replace(/_/g, ' '),
        required: opt.required,
        minSelect: opt.min_select,
        maxSelect: opt.max_select,
        minSelections: opt.min_select,
        maxSelections: opt.max_select,
        sortOrder: groupSortIndex,
        active: true,
        version: opt.version,
        options: [],
      });
    }

    const group = groupsMap.get(groupKey)!;
    const modifierOption: ViewModelModifierOption = {
      id: opt.id,
      name: opt.name,
      priceDeltaMinor: opt.price_delta_minor,
      priceDelta: minorToDecimal(opt.price_delta_minor),
      isAvailable: opt.available,
      sortOrder: group.options.length + 1,
      version: opt.version,
    };
    group.options.push(modifierOption);
  }

  return Array.from(groupsMap.values());
}

/**
 * Maps DTO Product to ViewModel MenuItem.
 * Price is converted to decimal purely for presentation; backend remains price source.
 */
export function mapDtoProductToViewModel(
  dto: DTOProduct,
  categoryName?: string
): ViewModelMenuItem {
  return {
    id: dto.id,
    version: dto.version,
    categoryId: dto.category_id,
    categoryName,
    name: dto.name,
    description: dto.description || '',
    price: minorToDecimal(dto.price_minor),
    priceMinor: dto.price_minor,
    imageUrl: dto.image_url || undefined,
    isAvailable: dto.available,
    modifierGroups: mapDtoProductOptionsToModifierGroups(dto.options),
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}
