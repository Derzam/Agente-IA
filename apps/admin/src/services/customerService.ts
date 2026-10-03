import { Customer } from '@/types/viewModels';
import { mockCustomers } from '@/mocks/mockData';
import { USE_MOCK_DATA, request } from './apiClient';

export const customerService = {
  async getCustomers(): Promise<Customer[]> {
    if (USE_MOCK_DATA) return Promise.resolve([...mockCustomers]);
    return request<Customer[]>('/customers');
  },

  async getCustomerById(id: string): Promise<Customer | undefined> {
    if (USE_MOCK_DATA) return Promise.resolve(mockCustomers.find((c) => c.id === id));
    return request<Customer>(`/customers/${id}`);
  },
};
