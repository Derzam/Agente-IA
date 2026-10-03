import type { Customer } from '@/types/viewModels';
import { mockCustomers } from '@/mocks/mockData';
import { USE_MOCK_DATA } from './apiClient';
import { endpoints } from '@/api/endpoints';
import { mapDtoCustomerToViewModel } from '@/adapters/customerAdapter';
import type { RequestOptions } from '@/api/types';

export const customerService = {
  async getCustomers(
    params?: { limit?: number; cursor?: string },
    options?: RequestOptions
  ): Promise<Customer[]> {
    if (USE_MOCK_DATA) {
      return Promise.resolve([...mockCustomers]);
    }

    const dtoList = await endpoints.getCustomers(params, undefined, options);
    return dtoList.map((dto) => mapDtoCustomerToViewModel(dto));
  },

  async getCustomerById(id: string, options?: RequestOptions): Promise<Customer | undefined> {
    if (USE_MOCK_DATA) {
      return Promise.resolve(mockCustomers.find((c) => c.id === id));
    }

    const dto = await endpoints.getCustomerById(id, undefined, options);
    return mapDtoCustomerToViewModel(dto);
  },
};
