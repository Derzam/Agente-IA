import type { MenuItem, MenuItemCategory, ModifierGroup } from '@/types/viewModels';
import type {
  Phase4ModifierGroup,
  Phase4ModifierOption,
} from '@/api/endpoints';
import { mockMenuItems, mockCategories } from '@/mocks/mockData';
import { USE_MOCK_DATA, newIdempotencyKey } from './apiClient';
import { endpoints } from '@/api/endpoints';
import {
  mapDtoCategoryToViewModel,
  mapDtoProductToViewModel,
} from '@/adapters/menuAdapter';
import { decimalToMinor } from '@/adapters/moneyAdapter';
import type { RequestOptions } from '@/api/types';

let localItems: MenuItem[] = [...mockMenuItems];
let localCategories: MenuItemCategory[] = [...mockCategories];

export async function syncProductModifiers(
  productId: string,
  groups: ModifierGroup[] = [],
  currentGroups: Array<Phase4ModifierGroup & { options: Phase4ModifierOption[] }> = [],
  options?: RequestOptions
): Promise<void> {
  const currentGroupById = new Map(currentGroups.map((group) => [group.id, group]));
  const retainedGroupIds = new Set<string>();

  for (const group of groups) {
    const existingGroup = currentGroupById.get(group.id);
    const persistedGroup = existingGroup
      ? await endpoints.updateModifierGroup(
          productId,
          existingGroup.id,
          {
            name: group.name.trim(),
            required: group.required,
            min_select: group.minSelect,
            max_select: group.maxSelect,
            sort_order: group.sortOrder,
            active: group.active,
            expected_version: existingGroup.version,
          },
          newIdempotencyKey(),
          undefined,
          options
        )
      : await endpoints.createModifierGroup(
          productId,
          {
            name: group.name.trim(),
            required: group.required,
            min_select: group.minSelect,
            max_select: group.maxSelect,
            sort_order: group.sortOrder,
            active: group.active,
          },
          newIdempotencyKey(),
          undefined,
          options
        );

    if (existingGroup) retainedGroupIds.add(existingGroup.id);

    const currentOptions = existingGroup?.options || [];
    const currentOptionById = new Map(currentOptions.map((option) => [option.id, option]));
    const retainedOptionIds = new Set<string>();

    for (const option of group.options) {
      const existingOption = currentOptionById.get(option.id);
      if (existingOption) {
        await endpoints.updateModifierOption(
          productId,
          persistedGroup.id,
          existingOption.id,
          {
            name: option.name.trim(),
            price_delta_minor: option.priceDeltaMinor,
            available: option.isAvailable,
            sort_order: option.sortOrder,
            expected_version: existingOption.version,
          },
          newIdempotencyKey(),
          undefined,
          options
        );
        retainedOptionIds.add(existingOption.id);
      } else {
        await endpoints.createModifierOption(
          productId,
          persistedGroup.id,
          {
            name: option.name.trim(),
            price_delta_minor: option.priceDeltaMinor,
            available: option.isAvailable,
            sort_order: option.sortOrder,
          },
          newIdempotencyKey(),
          undefined,
          options
        );
      }
    }

    for (const existingOption of currentOptions) {
      if (!retainedOptionIds.has(existingOption.id)) {
        await endpoints.deleteModifierOption(
          productId,
          persistedGroup.id,
          existingOption.id,
          existingOption.version,
          newIdempotencyKey(),
          undefined,
          options
        );
      }
    }
  }

  for (const existingGroup of currentGroups) {
    if (!retainedGroupIds.has(existingGroup.id)) {
      await endpoints.deleteModifierGroup(
        productId,
        existingGroup.id,
        existingGroup.version,
        newIdempotencyKey(),
        undefined,
        options
      );
    }
  }
}

export const menuService = {
  // ==========================================
  // CATEGORIES
  // ==========================================
  async getCategories(options?: RequestOptions): Promise<MenuItemCategory[]> {
    if (USE_MOCK_DATA) {
      return Promise.resolve([...localCategories].sort((a, b) => a.sortOrder - b.sortOrder));
    }

    const dtoList = await endpoints.getCategories(undefined, options);
    return dtoList.map(mapDtoCategoryToViewModel).sort((a, b) => a.sortOrder - b.sortOrder);
  },

  async createCategory(
    data: { name: string; sortOrder?: number; isActive?: boolean },
    idempotencyKey?: string,
    options?: RequestOptions
  ): Promise<MenuItemCategory> {
    const key = idempotencyKey || newIdempotencyKey();

    if (USE_MOCK_DATA) {
      const created: MenuItemCategory = {
        id: `cat-${Date.now()}`,
        name: data.name,
        slug: data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        sortOrder: data.sortOrder ?? localCategories.length + 1,
        isActive: data.isActive ?? true,
        version: 1,
      };
      localCategories.push(created);
      return Promise.resolve(created);
    }

    const createdDto = await endpoints.createCategory(
      {
        name: data.name,
        sort_order: data.sortOrder ?? localCategories.length + 1,
        active: data.isActive ?? true,
      },
      key,
      undefined,
      options
    );

    return mapDtoCategoryToViewModel(createdDto);
  },

  async updateCategory(
    category: MenuItemCategory,
    idempotencyKey?: string,
    options?: RequestOptions
  ): Promise<MenuItemCategory> {
    const key = idempotencyKey || newIdempotencyKey();

    if (USE_MOCK_DATA) {
      const index = localCategories.findIndex((c) => c.id === category.id);
      if (index === -1) throw new Error('Categoría no encontrada');
      const updated: MenuItemCategory = {
        ...category,
        slug: category.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        version: (category.version || 1) + 1,
      };
      localCategories[index] = updated;
      return Promise.resolve(updated);
    }

    const updatedDto = await endpoints.updateCategory(
      category.id,
      {
        name: category.name,
        sort_order: category.sortOrder,
        active: category.isActive,
        expected_version: category.version || 1,
      },
      key,
      undefined,
      options
    );

    return mapDtoCategoryToViewModel(updatedDto);
  },

  async deleteCategory(
    categoryId: string,
    expectedVersion = 1,
    idempotencyKey?: string,
    options?: RequestOptions
  ): Promise<void> {
    const key = idempotencyKey || newIdempotencyKey();

    if (USE_MOCK_DATA) {
      localCategories = localCategories.filter((c) => c.id !== categoryId);
      return Promise.resolve();
    }

    await endpoints.deleteCategory(categoryId, expectedVersion, key, undefined, options);
  },

  async toggleCategoryActive(
    categoryId: string,
    isActive: boolean,
    expectedVersion = 1,
    idempotencyKey?: string,
    options?: RequestOptions
  ): Promise<MenuItemCategory> {
    const key = idempotencyKey || newIdempotencyKey();

    if (USE_MOCK_DATA) {
      const index = localCategories.findIndex((c) => c.id === categoryId);
      if (index === -1) throw new Error('Categoría no encontrada');
      const updated: MenuItemCategory = {
        ...localCategories[index],
        isActive,
        version: (localCategories[index].version || 1) + 1,
      };
      localCategories[index] = updated;
      return Promise.resolve(updated);
    }

    const updatedDto = await endpoints.updateCategory(
      categoryId,
      {
        active: isActive,
        expected_version: expectedVersion,
      },
      key,
      undefined,
      options
    );

    return mapDtoCategoryToViewModel(updatedDto);
  },

  // ==========================================
  // PRODUCTS & MODIFIERS
  // ==========================================
  async getMenuItems(categoryId?: string, options?: RequestOptions): Promise<MenuItem[]> {
    if (USE_MOCK_DATA) {
      if (categoryId && categoryId !== 'all') {
        return Promise.resolve(localItems.filter((i) => i.categoryId === categoryId));
      }
      return Promise.resolve([...localItems]);
    }

    const dtoList = await endpoints.getProducts(
      categoryId && categoryId !== 'all' ? { category_id: categoryId } : undefined,
      undefined,
      options
    );

    return dtoList.map((dto) => mapDtoProductToViewModel(dto));
  },

  async createItem(
    item: Omit<MenuItem, 'id' | 'createdAt' | 'updatedAt' | 'version'>,
    idempotencyKey?: string,
    options?: RequestOptions
  ): Promise<MenuItem> {
    const key = idempotencyKey || newIdempotencyKey();
    const now = new Date().toISOString();

    if (USE_MOCK_DATA) {
      const created: MenuItem = {
        ...item,
        id: `item-${Date.now()}`,
        version: 1,
        priceMinor: item.priceMinor ?? decimalToMinor(item.price),
        createdAt: now,
        updatedAt: now,
      };
      localItems.unshift(created);
      return Promise.resolve(created);
    }

    const createdDto = await endpoints.createProduct(
      {
        category_id: item.categoryId,
        name: item.name,
        description: item.description || null,
        price_minor: item.priceMinor ?? decimalToMinor(item.price),
        currency: 'USD',
        available: item.isAvailable,
        image_url: item.imageUrl || null,
      },
      key,
      undefined,
      options
    );

    await syncProductModifiers(createdDto.id, item.modifierGroups || [], [], options);
    const refreshedDto = await endpoints.getProductById(createdDto.id, undefined, options);
    return mapDtoProductToViewModel(refreshedDto);
  },

  async toggleAvailability(
    itemId: string,
    isAvailable: boolean,
    expectedVersion = 1,
    idempotencyKey?: string,
    options?: RequestOptions
  ): Promise<MenuItem> {
    const key = idempotencyKey || newIdempotencyKey();

    if (USE_MOCK_DATA) {
      const index = localItems.findIndex((i) => i.id === itemId);
      if (index === -1) throw new Error('Menu item not found');
      const updated: MenuItem = {
        ...localItems[index],
        isAvailable,
        version: (localItems[index].version || 1) + 1,
        updatedAt: new Date().toISOString(),
      };
      localItems[index] = updated;
      return Promise.resolve(updated);
    }

    const updatedDto = await endpoints.updateProduct(
      itemId,
      {
        available: isAvailable,
        expected_version: expectedVersion,
      },
      key,
      undefined,
      options
    );

    return mapDtoProductToViewModel(updatedDto);
  },

  async updateItem(
    item: MenuItem,
    idempotencyKey?: string,
    options?: RequestOptions
  ): Promise<MenuItem> {
    const key = idempotencyKey || newIdempotencyKey();

    if (USE_MOCK_DATA) {
      const index = localItems.findIndex((i) => i.id === item.id);
      if (index === -1) {
        localItems.push(item);
      } else {
        localItems[index] = {
          ...item,
          priceMinor: item.priceMinor ?? decimalToMinor(item.price),
          version: (item.version || 1) + 1,
          updatedAt: new Date().toISOString(),
        };
      }
      return Promise.resolve(item);
    }

    const currentDto = await endpoints.getProductById(item.id, undefined, options);
    await endpoints.updateProduct(
      item.id,
      {
        category_id: item.categoryId,
        name: item.name,
        description: item.description,
        price_minor: item.priceMinor ?? decimalToMinor(item.price),
        available: item.isAvailable,
        image_url: item.imageUrl || null,
        expected_version: item.version || 1,
      },
      key,
      undefined,
      options
    );

    await syncProductModifiers(item.id, item.modifierGroups || [], currentDto.modifier_groups || [], options);
    const refreshedDto = await endpoints.getProductById(item.id, undefined, options);
    return mapDtoProductToViewModel(refreshedDto);
  },

  async deleteItem(
    itemId: string,
    expectedVersion = 1,
    idempotencyKey?: string,
    options?: RequestOptions
  ): Promise<void> {
    const key = idempotencyKey || newIdempotencyKey();

    if (USE_MOCK_DATA) {
      localItems = localItems.filter((i) => i.id !== itemId);
      return Promise.resolve();
    }

    await endpoints.deleteProduct(itemId, expectedVersion, key, undefined, options);
  },
};
