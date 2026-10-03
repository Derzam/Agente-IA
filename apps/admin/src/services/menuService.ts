import { MenuItem, MenuItemCategory } from '@/types/viewModels';
import { mockMenuItems, mockCategories } from '@/mocks/mockData';
import { USE_MOCK_DATA, request } from './apiClient';

let localItems: MenuItem[] = [...mockMenuItems];
let localCategories: MenuItemCategory[] = [...mockCategories];

export const menuService = {
  async getCategories(): Promise<MenuItemCategory[]> {
    if (USE_MOCK_DATA) {
      return Promise.resolve([...localCategories]);
    }
    return request<MenuItemCategory[]>('/menu/categories');
  },

  async getMenuItems(categoryId?: string): Promise<MenuItem[]> {
    if (USE_MOCK_DATA) {
      if (categoryId) {
        return Promise.resolve(localItems.filter((i) => i.categoryId === categoryId));
      }
      return Promise.resolve([...localItems]);
    }
    return request<MenuItem[]>(`/menu/items${categoryId ? `?categoryId=${categoryId}` : ''}`);
  },

  async toggleAvailability(itemId: string, isAvailable: boolean): Promise<MenuItem> {
    if (USE_MOCK_DATA) {
      const index = localItems.findIndex((i) => i.id === itemId);
      if (index === -1) throw new Error('Menu item not found');
      const updated: MenuItem = {
        ...localItems[index],
        isAvailable,
        updatedAt: new Date().toISOString(),
      };
      localItems[index] = updated;
      return Promise.resolve(updated);
    }
    return request<MenuItem>(`/menu/items/${itemId}/availability`, {
      method: 'PATCH',
      body: JSON.stringify({ isAvailable }),
    });
  },

  async updateItem(item: MenuItem): Promise<MenuItem> {
    if (USE_MOCK_DATA) {
      const index = localItems.findIndex((i) => i.id === item.id);
      if (index === -1) {
        localItems.push(item);
      } else {
        localItems[index] = { ...item, updatedAt: new Date().toISOString() };
      }
      return Promise.resolve(item);
    }
    return request<MenuItem>(`/menu/items/${item.id}`, {
      method: 'PUT',
      body: JSON.stringify(item),
    });
  },
};
