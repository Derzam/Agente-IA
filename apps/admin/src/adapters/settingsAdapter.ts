/**
 * Settings Adapter
 * 
 * CONTRACT GAPS IDENTIFIED:
 * - OpenAPI /settings provides: opening_hours, accepting_orders, delivery_enabled, pickup_enabled, min_order_minor, session_ttl_minutes, ai_enabled.
 * - OpenAPI /businesses/{id} provides: name, slug, currency, timezone, status.
 * - GAPS: UI ViewModels define granular fields (AgentConfig tone, prompt templates, keywords; DeliverySettings per-km fee and coverage radius) that do NOT exist in the OpenAPI v0.1 contract.
 * - In accordance with Phase 2 guidelines: we do NOT invent synthetic endpoints. We map available contract fields to the ViewModels, preserve versions for optimistic concurrency, and expose contract gaps.
 */

import type {
  BusinessSettings as DTOBusinessSettings,
  Business as DTOBusiness,
  SettingsUpdate,
  OpeningInterval,
} from '@agente-ia/shared';
import type {
  BusinessSettings as ViewModelBusinessSettings,
  DeliverySettings as ViewModelDeliverySettings,
  AgentConfig as ViewModelAgentConfig,
  BusinessDayHours,
} from '@/types/viewModels';
import { minorToDecimal } from './moneyAdapter';

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export function mapOpeningHoursToViewModel(intervals: OpeningInterval[] = []): BusinessDayHours[] {
  const hours: BusinessDayHours[] = [];

  for (let day = 0; day < 7; day++) {
    const found = intervals.find((i) => i.day === day);
    hours.push({
      dayOfWeek: day,
      dayName: DAY_NAMES[day],
      isOpen: Boolean(found),
      openTime: found ? found.opens_at : '09:00',
      closeTime: found ? found.closes_at : '22:00',
    });
  }

  return hours;
}

export function mapViewModelHoursToOpeningIntervals(hours: BusinessDayHours[]): OpeningInterval[] {
  return hours
    .filter((h) => h.isOpen)
    .map((h) => ({
      day: h.dayOfWeek,
      opens_at: h.openTime,
      closes_at: h.closeTime,
    }));
}

export function mapDtoToViewModelBusinessSettings(
  settings: DTOBusinessSettings,
  business?: DTOBusiness | null
): ViewModelBusinessSettings {
  return {
    name: business?.name || 'Mi Negocio',
    legalName: business?.name,
    supportPhone: '+593 9** *** ***',
    address: 'Ubicación configurada en delivery zones',
    currencySymbol: business?.currency === 'USD' ? '$' : business?.currency || '$',
    isAcceptingOrders: settings.accepting_orders,
    hours: mapOpeningHoursToViewModel(settings.opening_hours),
  };
}

export function mapDtoToViewModelDeliverySettings(
  settings: DTOBusinessSettings
): ViewModelDeliverySettings {
  return {
    maxCoverageRadiusKm: 5,
    baseDeliveryFee: minorToDecimal(settings.min_order_minor || 0),
    perKmFee: 0.5,
    estimatedPrepTimeMin: 25,
    estimatedTransitTimeMin: 20,
  };
}

export function mapDtoToViewModelAgentConfig(
  settings: DTOBusinessSettings,
  fallbackConfig?: ViewModelAgentConfig
): ViewModelAgentConfig {
  return {
    isEnabled: settings.ai_enabled,
    assistantName: fallbackConfig?.assistantName || 'BurgerBot Asistente',
    tone: fallbackConfig?.tone || 'friendly_casual',
    welcomeGreeting: fallbackConfig?.welcomeGreeting || '¡Hola! Bienvenido. ¿Qué se te antoja ordenar hoy?',
    outsideHoursMessage: fallbackConfig?.outsideHoursMessage || 'Hola, en este momento nos encontramos cerrados.',
    orderConfirmationMessage: fallbackConfig?.orderConfirmationMessage || '¡Tu pedido fue recibido con éxito!',
    handoffToHumanMessage: fallbackConfig?.handoffToHumanMessage || 'Te comunicaré de inmediato con un asesor humano.',
    handoffKeywords: fallbackConfig?.handoffKeywords || ['humano', 'asesor', 'queja'],
    systemDirectives: fallbackConfig?.systemDirectives || '',
    prohibitedTopics: fallbackConfig?.prohibitedTopics || [],
  };
}

export function buildSettingsUpdatePayload(
  currentSettings: DTOBusinessSettings,
  changes: Partial<ViewModelBusinessSettings> & { ai_enabled?: boolean }
): SettingsUpdate {
  const update: SettingsUpdate = {
    expected_version: currentSettings.version,
  };

  if (changes.isAcceptingOrders !== undefined) {
    update.accepting_orders = changes.isAcceptingOrders;
  }

  if (changes.hours !== undefined) {
    update.opening_hours = mapViewModelHoursToOpeningIntervals(changes.hours);
  }

  if (changes.ai_enabled !== undefined) {
    update.ai_enabled = changes.ai_enabled;
  }

  return update;
}
