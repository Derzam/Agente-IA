import type { DashboardMetrics, HourlySalesData } from '@/types/viewModels';
import { mockDashboardMetrics, mockHourlySales } from '@/mocks/mockData';
import { USE_MOCK_DATA } from './apiClient';
import { endpoints } from '@/api/endpoints';
import {
  mapDtoMetricsToViewModel,
  getDefaultDateRange,
} from '@/adapters/metricsAdapter';
import type { RequestOptions } from '@/api/types';

export const metricsService = {
  /**
   * Fetches metrics strictly via canonical GET /metrics with from/to query parameters.
   */
  async getDashboardMetrics(
    range?: { from: string; to: string },
    options?: RequestOptions
  ): Promise<DashboardMetrics> {
    if (USE_MOCK_DATA) {
      return Promise.resolve({ ...mockDashboardMetrics });
    }

    const { from, to } = range || getDefaultDateRange();
    const dtoMetrics = await endpoints.getMetrics(from, to, undefined, options);
    return mapDtoMetricsToViewModel(dtoMetrics);
  },

  /**
   * Note: Hourly sales breakdowns are not defined by the OpenAPI v0.1 contract.
   * In mock mode, sample distribution is returned. In real mode, returns empty dataset
   * to avoid making unauthorized or non-existent endpoint calls.
   */
  async getHourlySales(): Promise<HourlySalesData[]> {
    if (USE_MOCK_DATA) {
      return Promise.resolve([...mockHourlySales]);
    }
    return Promise.resolve([]);
  },
};
