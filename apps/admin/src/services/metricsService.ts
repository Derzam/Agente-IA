import { DashboardMetrics, HourlySalesData } from '@agente-ia/shared';
import { mockDashboardMetrics, mockHourlySales } from '@/mocks/mockData';
import { USE_MOCK_DATA, request } from './apiClient';

export const metricsService = {
  async getDashboardMetrics(): Promise<DashboardMetrics> {
    if (USE_MOCK_DATA) return Promise.resolve({ ...mockDashboardMetrics });
    return request<DashboardMetrics>('/dashboard/metrics');
  },

  async getHourlySales(): Promise<HourlySalesData[]> {
    if (USE_MOCK_DATA) return Promise.resolve([...mockHourlySales]);
    return request<HourlySalesData[]>('/metrics/hourly-sales');
  },
};
