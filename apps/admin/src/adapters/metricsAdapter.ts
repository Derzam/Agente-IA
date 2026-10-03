/**
 * Metrics Adapter
 * 
 * CONTRACT GAPS IDENTIFIED:
 * - OpenAPI /metrics returns aggregate numbers for [from, to):
 *   orders_confirmed, orders_cancelled, handoffs_created, sales_minor, currency, generated_at.
 * - GAPS: Top selling items and hourly sales distribution endpoints are not present in OpenAPI v0.1.
 * - This adapter maps canonical Metrics to ViewModel DashboardMetrics, with mock/fallback for missing breakdowns.
 */

import type { Metrics as DTOMetrics } from '@agente-ia/shared';
import type { DashboardMetrics as ViewModelDashboardMetrics } from '@/types/viewModels';
import { minorToDecimal } from './moneyAdapter';

export function mapDtoMetricsToViewModel(
  dto: DTOMetrics,
  supplementary?: {
    newOrders?: number;
    inKitchen?: number;
    readyOrDelivering?: number;
    waitingChats?: number;
  }
): ViewModelDashboardMetrics {
  const dailySales = minorToDecimal(dto.sales_minor);
  const confirmed = dto.orders_confirmed;
  const avgTicket = confirmed > 0 ? Number((dailySales / confirmed).toFixed(2)) : 0;

  return {
    newOrdersCount: supplementary?.newOrders ?? 0,
    inKitchenCount: supplementary?.inKitchen ?? 0,
    readyOrDeliveringCount: supplementary?.readyOrDelivering ?? 0,
    completedTodayCount: confirmed,
    waitingHumanChatsCount: supplementary?.waitingChats ?? dto.handoffs_created,
    dailySalesTotal: dailySales,
    averageTicket: avgTicket,
    topSellingItems: [],
  };
}

export function getDefaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  return {
    from: startOfDay.toISOString(),
    to: now.toISOString(),
  };
}
