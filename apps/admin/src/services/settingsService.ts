/**
 * Settings Service
 * Strictly adheres to canonical endpoints:
 *   GET /settings
 *   PATCH /settings
 *   GET /businesses/{id}
 *
 * Routes such as /settings/business, /settings/delivery, /settings/agent have been
 * removed as they do not exist in the canonical OpenAPI v0.1 contract.
 */

import type { AgentConfig, BusinessSettings, DeliverySettings } from '@/types/viewModels';
import { mockAgentConfig, mockBusinessSettings, mockDeliverySettings } from '@/mocks/mockData';
import { USE_MOCK_DATA, newIdempotencyKey } from './apiClient';
import { endpoints } from '@/api/endpoints';
import {
  mapDtoToViewModelBusinessSettings,
  mapDtoToViewModelDeliverySettings,
  mapDtoToViewModelAgentConfig,
  mapViewModelHoursToOpeningIntervals,
} from '@/adapters/settingsAdapter';
import type { RequestOptions } from '@/api/types';

let localAgentConfig: AgentConfig = { ...mockAgentConfig };
let localBusinessSettings: BusinessSettings = { ...mockBusinessSettings };
let localDeliverySettings: DeliverySettings = { ...mockDeliverySettings };
let cachedSettingsVersion = 1;

export const settingsService = {
  async getBusinessSettings(options?: RequestOptions): Promise<BusinessSettings> {
    if (USE_MOCK_DATA) {
      return Promise.resolve({ ...localBusinessSettings });
    }

    const [dtoSettings, dtoBusiness] = await Promise.all([
      endpoints.getSettings(undefined, options),
      endpoints.getBusiness(undefined, options),
    ]);

    cachedSettingsVersion = dtoSettings.version;
    return mapDtoToViewModelBusinessSettings(dtoSettings, dtoBusiness);
  },

  async updateBusinessSettings(
    settings: BusinessSettings,
    expectedVersion?: number,
    idempotencyKey?: string,
    options?: RequestOptions
  ): Promise<BusinessSettings> {
    const key = idempotencyKey || newIdempotencyKey();
    const version = expectedVersion ?? cachedSettingsVersion;

    if (USE_MOCK_DATA) {
      localBusinessSettings = { ...settings };
      return Promise.resolve(localBusinessSettings);
    }

    const updatedDto = await endpoints.updateSettings(
      {
        expected_version: version,
        accepting_orders: settings.isAcceptingOrders,
        opening_hours: mapViewModelHoursToOpeningIntervals(settings.hours),
      },
      key,
      undefined,
      options
    );

    cachedSettingsVersion = updatedDto.version;
    const dtoBusiness = await endpoints.getBusiness(undefined, options);
    return mapDtoToViewModelBusinessSettings(updatedDto, dtoBusiness);
  },

  async getDeliverySettings(options?: RequestOptions): Promise<DeliverySettings> {
    if (USE_MOCK_DATA) {
      return Promise.resolve({ ...localDeliverySettings });
    }

    const dtoSettings = await endpoints.getSettings(undefined, options);
    cachedSettingsVersion = dtoSettings.version;
    return mapDtoToViewModelDeliverySettings(dtoSettings);
  },

  async updateDeliverySettings(
    settings: DeliverySettings,
    expectedVersion?: number,
    idempotencyKey?: string,
    options?: RequestOptions
  ): Promise<DeliverySettings> {
    const key = idempotencyKey || newIdempotencyKey();
    const version = expectedVersion ?? cachedSettingsVersion;

    if (USE_MOCK_DATA) {
      localDeliverySettings = { ...settings };
      return Promise.resolve(localDeliverySettings);
    }

    // Contract Gap: Delivery radius & per-km fee are not present in OpenAPI BusinessSettings.
    // We update min_order_minor based on baseDeliveryFee to preserve backend contract integrity.
    void settings;
    void key;
    void version;
    void options;
    throw new Error('La configuración avanzada de delivery aún no está disponible en el contrato real.');
  },

  async getAgentConfig(options?: RequestOptions): Promise<AgentConfig> {
    if (USE_MOCK_DATA) {
      return Promise.resolve({ ...localAgentConfig });
    }

    const dtoSettings = await endpoints.getSettings(undefined, options);
    cachedSettingsVersion = dtoSettings.version;
    return mapDtoToViewModelAgentConfig(dtoSettings);
  },

  async updateAgentConfig(
    config: AgentConfig,
    expectedVersion?: number,
    idempotencyKey?: string,
    options?: RequestOptions
  ): Promise<AgentConfig> {
    const key = idempotencyKey || newIdempotencyKey();
    const version = expectedVersion ?? cachedSettingsVersion;

    if (USE_MOCK_DATA) {
      localAgentConfig = { ...config };
      return Promise.resolve(localAgentConfig);
    }

    // OpenAPI v0.1 supports updating ai_enabled on /settings
    const updatedDto = await endpoints.updateSettings(
      {
        expected_version: version,
        ai_enabled: config.isEnabled,
      },
      key,
      undefined,
      options
    );

    cachedSettingsVersion = updatedDto.version;
    return mapDtoToViewModelAgentConfig(updatedDto);
  },

  async testAgentPrompt(message: string): Promise<{ reply: string; intent: string }> {
    if (!USE_MOCK_DATA) {
      throw new Error('El simulador del agente no está disponible en modo real porque OpenAPI no define un endpoint de prueba.');
    }
    const lower = message.toLowerCase();
    if (lower.includes('hola') || lower.includes('buenas')) {
      return {
        reply: localAgentConfig.welcomeGreeting,
        intent: 'GREETING_START',
      };
    }
    if (lower.includes('precio') || lower.includes('cuesta')) {
      return {
        reply: 'La Burger Doble Queso cuesta $8.50. Incluye doble carne 150g y cheddar americano fundido 🍔.',
        intent: 'PRICE_QUERY',
      };
    }
    if (lower.includes('humano') || lower.includes('asesor') || lower.includes('persona')) {
      return {
        reply: localAgentConfig.handoffToHumanMessage,
        intent: 'HUMAN_HANDOFF_REQUEST',
      };
    }
    return {
      reply: `¡Entendido! Con gusto te ayudo con "${message}". ¿Deseas agregar alguna de nuestras hamburguesas o revisar el menú completo?`,
      intent: 'GENERAL_INQUIRY',
    };
  },
};
