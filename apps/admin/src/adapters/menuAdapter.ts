import type {
  Category as DTOCategory,
  ProductOption as DTOProductOption,
  ProductOptionInput as DTOProductOptionInput,
} from '@agente-ia/shared';
import type {
  Phase4Product as DTOProduct,
  Phase4ModifierGroup as DTOModifierGroup,
  Phase4ModifierOption as DTOModifierOption,
} from '@/api/endpoints';
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

export function modifierGroupKey(group: ViewModelModifierGroup): string {
  const normalized = group.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || group.id || 'general';
}

export function mapModifierOptionToDtoInput(
  group: ViewModelModifierGroup,
  option: ViewModelModifierOption
): DTOProductOptionInput {
  return {
    group_key: modifierGroupKey(group),
    name: option.name.trim(),
    price_delta_minor: option.priceDeltaMinor,
    required: group.required,
    min_select: group.minSelect,
    max_select: group.maxSelect,
    available: group.active && option.isAvailable,
  };
}

export function flattenModifierGroupsForWrite(groups: ViewModelModifierGroup[] = []) {
  return groups.flatMap((group) =>
    group.options.map((option) => ({
      clientOptionId: option.id,
      input: mapModifierOptionToDtoInput(group, option),
    }))
  );
}

export function mapCanonicalModifierGroupsToViewModel(
  groups: Array<DTOModifierGroup & { options: DTOModifierOption[] }> = []
): ViewModelModifierGroup[] {
  return groups
    .map((group) => ({
      id: group.id,
      name: group.name,
      required: group.required,
      minSelect: group.min_select,
      maxSelect: group.max_select,
      minSelections: group.min_select,
      maxSelections: group.max_select,
      sortOrder: group.sort_order,
      active: group.active,
      version: group.version,
      options: (group.options || [])
        .map((option) => ({
          id: option.id,
          name: option.name,
          priceDeltaMinor: option.price_delta_minor,
          priceDelta: minorToDecimal(option.price_delta_minor),
          isAvailable: option.available,
          sortOrder: option.sort_order,
          version: option.version,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
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

  return Array.from(groupsMap.values()).map((group) => ({
    ...group,
    // Transitional flat API has no group-level active flag. An inactive group is
    // represented by all of its options being unavailable until the hierarchical
    // ModifierGroup contract is exposed by the backend.
    active: group.options.some((option) => option.isAvailable),
  }));
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
    modifierGroups:
      dto.modifier_groups !== undefined
        ? mapCanonicalModifierGroupsToViewModel(dto.modifier_groups)
        : mapDtoProductOptionsToModifierGroups(dto.options),
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}
