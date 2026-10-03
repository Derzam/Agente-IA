import { AgentConfig, BusinessSettings, DeliverySettings } from '@agente-ia/shared';
import { mockAgentConfig, mockBusinessSettings, mockDeliverySettings } from '@/mocks/mockData';
import { USE_MOCK_DATA, request } from './apiClient';

let localAgentConfig: AgentConfig = { ...mockAgentConfig };
let localBusinessSettings: BusinessSettings = { ...mockBusinessSettings };
let localDeliverySettings: DeliverySettings = { ...mockDeliverySettings };

export const settingsService = {
  async getAgentConfig(): Promise<AgentConfig> {
    if (USE_MOCK_DATA) return Promise.resolve({ ...localAgentConfig });
    return request<AgentConfig>('/settings/agent');
  },

  async updateAgentConfig(config: AgentConfig): Promise<AgentConfig> {
    if (USE_MOCK_DATA) {
      localAgentConfig = { ...config };
      return Promise.resolve(localAgentConfig);
    }
    return request<AgentConfig>('/settings/agent', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },

  async getBusinessSettings(): Promise<BusinessSettings> {
    if (USE_MOCK_DATA) return Promise.resolve({ ...localBusinessSettings });
    return request<BusinessSettings>('/settings/business');
  },

  async updateBusinessSettings(settings: BusinessSettings): Promise<BusinessSettings> {
    if (USE_MOCK_DATA) {
      localBusinessSettings = { ...settings };
      return Promise.resolve(localBusinessSettings);
    }
    return request<BusinessSettings>('/settings/business', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  },

  async getDeliverySettings(): Promise<DeliverySettings> {
    if (USE_MOCK_DATA) return Promise.resolve({ ...localDeliverySettings });
    return request<DeliverySettings>('/settings/delivery');
  },

  async updateDeliverySettings(settings: DeliverySettings): Promise<DeliverySettings> {
    if (USE_MOCK_DATA) {
      localDeliverySettings = { ...settings };
      return Promise.resolve(localDeliverySettings);
    }
    return request<DeliverySettings>('/settings/delivery', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  },

  async testAgentPrompt(message: string): Promise<{ reply: string; intent: string }> {
    if (USE_MOCK_DATA) {
      const lower = message.toLowerCase();
      if (lower.includes('hola') || lower.includes('buenas')) {
        return Promise.resolve({
          reply: localAgentConfig.welcomeGreeting,
          intent: 'GREETING_START',
        });
      }
      if (lower.includes('precio') || lower.includes('cuesta')) {
        return Promise.resolve({
          reply: 'La Burger Doble Queso cuesta $8.50. Incluye doble carne 150g y cheddar americano fundido 🍔.',
          intent: 'PRICE_QUERY',
        });
      }
      if (lower.includes('humano') || lower.includes('asesor') || lower.includes('persona')) {
        return Promise.resolve({
          reply: localAgentConfig.handoffToHumanMessage,
          intent: 'HUMAN_HANDOFF_REQUEST',
        });
      }
      return Promise.resolve({
        reply: `¡Entendido! Con gusto te ayudo con "${message}". ¿Deseas agregar alguna de nuestras hamburguesas o revisar el menú completo?`,
        intent: 'GENERAL_INQUIRY',
      });
    }
    return request<{ reply: string; intent: string }>('/settings/agent/test-prompt', {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  },
};
