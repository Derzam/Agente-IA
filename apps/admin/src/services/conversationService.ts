import { ConversationSummary, ChatMessage } from '@agente-ia/shared';
import { mockConversations, mockMessagesByConversation } from '@/mocks/mockData';
import { USE_MOCK_DATA, request } from './apiClient';

let localConversations: ConversationSummary[] = [...mockConversations];
let localMessages: Record<string, ChatMessage[]> = { ...mockMessagesByConversation };

export const conversationService = {
  async getConversations(): Promise<ConversationSummary[]> {
    if (USE_MOCK_DATA) {
      return Promise.resolve([...localConversations]);
    }
    return request<ConversationSummary[]>('/conversations');
  },

  async getMessages(conversationId: string): Promise<ChatMessage[]> {
    if (USE_MOCK_DATA) {
      return Promise.resolve([...(localMessages[conversationId] || [])]);
    }
    return request<ChatMessage[]>(`/conversations/${conversationId}/messages`);
  },

  async sendMessage(
    conversationId: string,
    content: string,
    sender: 'staff' | 'customer' = 'staff',
    isInternalNote = false
  ): Promise<ChatMessage> {
    if (USE_MOCK_DATA) {
      const newMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        conversationId,
        sender,
        senderName: isInternalNote ? 'Nota de Staff' : 'Operador Carlos',
        type: isInternalNote ? 'internal_note' : 'text',
        content,
        timestamp: new Date().toISOString(),
        isInternalNote,
      };

      if (!localMessages[conversationId]) {
        localMessages[conversationId] = [];
      }
      localMessages[conversationId].push(newMsg);

      // Update conversation snippet
      const convIndex = localConversations.findIndex((c) => c.id === conversationId);
      if (convIndex !== -1 && !isInternalNote) {
        localConversations[convIndex] = {
          ...localConversations[convIndex],
          lastMessageSnippet: content,
          lastMessageTime: newMsg.timestamp,
        };
      }

      return Promise.resolve(newMsg);
    }
    return request<ChatMessage>(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, isInternalNote }),
    });
  },

  async takeoverConversation(conversationId: string, operatorName: string): Promise<ConversationSummary> {
    if (USE_MOCK_DATA) {
      const index = localConversations.findIndex((c) => c.id === conversationId);
      if (index === -1) throw new Error('Conversation not found');
      const updated: ConversationSummary = {
        ...localConversations[index],
        status: 'human_active',
        assignedOperatorName: operatorName,
      };
      localConversations[index] = updated;
      return Promise.resolve(updated);
    }
    return request<ConversationSummary>(`/conversations/${conversationId}/takeover`, {
      method: 'POST',
      body: JSON.stringify({ operatorName }),
    });
  },

  async returnToBot(conversationId: string): Promise<ConversationSummary> {
    if (USE_MOCK_DATA) {
      const index = localConversations.findIndex((c) => c.id === conversationId);
      if (index === -1) throw new Error('Conversation not found');
      const updated: ConversationSummary = {
        ...localConversations[index],
        status: 'bot_active',
        assignedOperatorName: undefined,
      };
      localConversations[index] = updated;

      // Add bot reentry message
      const botMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        conversationId,
        sender: 'bot',
        type: 'text',
        content: '¡Listo! Nuestro asistente virtual ha retomado la conversación 🤖. ¿En qué más te puedo ayudar?',
        timestamp: new Date().toISOString(),
      };
      if (!localMessages[conversationId]) localMessages[conversationId] = [];
      localMessages[conversationId].push(botMsg);

      return Promise.resolve(updated);
    }
    return request<ConversationSummary>(`/conversations/${conversationId}/return-to-bot`, {
      method: 'POST',
    });
  },

  async resolveConversation(conversationId: string): Promise<ConversationSummary> {
    if (USE_MOCK_DATA) {
      const index = localConversations.findIndex((c) => c.id === conversationId);
      if (index === -1) throw new Error('Conversation not found');
      const updated: ConversationSummary = {
        ...localConversations[index],
        status: 'closed',
      };
      localConversations[index] = updated;
      return Promise.resolve(updated);
    }
    return request<ConversationSummary>(`/conversations/${conversationId}/resolve`, {
      method: 'POST',
    });
  },
};
