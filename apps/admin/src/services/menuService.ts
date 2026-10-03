import type { MenuItem, MenuItemCategory } from '@/types/viewModels';
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

export const menuService = {
  async getCategories(options?: RequestOptions): Promise<MenuItemCategory[]> {
    if (USE_MOCK_DATA) {
      return Promise.resolve([...localCategories]);
    }

    const dtoList = await endpoints.getCategories(undefined, options);
    return dtoList.map(mapDtoCategoryToViewModel);
  },

  async getMenuItems(categoryId?: string, options?: RequestOptions): Promise<MenuItem[]> {
    if (USE_MOCK_DATA) {
      if (categoryId) {
        return Promise.resolve(localItems.filter((i) => i.categoryId === categoryId));
      }
      return Promise.resolve([...localItems]);
    }

    const dtoList = await endpoints.getProducts(
      categoryId ? { category_id: categoryId } : undefined,
      undefined,
      options
    );

    return dtoList.map((dto) => mapDtoProductToViewModel(dto));
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
          version: (item.version || 1) + 1,
          updatedAt: new Date().toISOString(),
        };
      }
      return Promise.resolve(item);
    }

    const updatedDto = await endpoints.updateProduct(
      item.id,
      {
        name: item.name,
        description: item.description,
        price_minor: decimalToMinor(item.price),
        available: item.isAvailable,
        expected_version: item.version || 1,
      },
      key,
      undefined,
      options
    );

    return mapDtoProductToViewModel(updatedDto);
  },
};
