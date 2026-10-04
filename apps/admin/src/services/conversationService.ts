import type { ConversationSummary, ChatMessage } from '@/types/viewModels';
import type { HandoffReason, UUID } from '@agente-ia/shared';
import { mockConversations, mockMessagesByConversation } from '@/mocks/mockData';
import { USE_MOCK_DATA, newIdempotencyKey } from './apiClient';
import { endpoints } from '@/api/endpoints';
import {
  mapDtoConversationToViewModel,
  mapDtoMessageToViewModel,
} from '@/adapters/conversationAdapter';
import type { RequestOptions } from '@/api/types';

let localConversations: ConversationSummary[] = [...mockConversations];
let localMessages: Record<string, ChatMessage[]> = { ...mockMessagesByConversation };

export const conversationService = {
  async getConversations(
    params?: { status?: string; limit?: number; cursor?: string },
    options?: RequestOptions
  ): Promise<ConversationSummary[]> {
    if (USE_MOCK_DATA) {
      if (params?.status && params.status !== 'all') {
        return Promise.resolve(localConversations.filter((c) => c.status === params.status));
      }
      return Promise.resolve([...localConversations]);
    }

    const dtoList = await endpoints.getConversations(params, undefined, options);
    return dtoList.map((dto) => mapDtoConversationToViewModel(dto));
  },

  async getMessages(conversationId: string, options?: RequestOptions): Promise<ChatMessage[]> {
    if (USE_MOCK_DATA) {
      return Promise.resolve([...(localMessages[conversationId] || [])]);
    }

    const dtoList = await endpoints.getMessages(conversationId, undefined, undefined, options);
    return dtoList.map(mapDtoMessageToViewModel);
  },

  async sendMessage(
    conversationId: string,
    text: string,
    expectedConversationVersion = 1,
    isInternalNote = false,
    idempotencyKey?: string,
    options?: RequestOptions
  ): Promise<ChatMessage> {
    const key = idempotencyKey || newIdempotencyKey();

    if (USE_MOCK_DATA) {
      const newMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        conversationId,
        sender: 'staff',
        senderName: isInternalNote ? 'Nota de Staff' : 'Operador en Turno',
        type: isInternalNote ? 'internal_note' : 'text',
        content: text,
        timestamp: new Date().toISOString(),
        isInternalNote,
      };

      if (!localMessages[conversationId]) {
        localMessages[conversationId] = [];
      }
      localMessages[conversationId].push(newMsg);

      const convIndex = localConversations.findIndex((c) => c.id === conversationId);
      if (convIndex !== -1 && !isInternalNote) {
        localConversations[convIndex] = {
          ...localConversations[convIndex],
          lastMessageSnippet: text,
          lastMessageTime: newMsg.timestamp,
        };
      }

      return Promise.resolve(newMsg);
    }

    if (!USE_MOCK_DATA && isInternalNote) {
      throw new Error('Las notas internas privadas no están soportadas por el contrato de la API v0.1.');
    }

    // Call canonical POST /conversations/{id}/messages
    const receipt = await endpoints.sendMessage(
      conversationId,
      {
        text,
        expected_conversation_version: expectedConversationVersion,
      },
      key,
      undefined,
      options
    );

    // Return message receipt with status 'queued' (202 Accepted)
    return {
      id: receipt?.outbox_id || `msg-${Date.now()}`,
      conversationId,
      sender: 'staff',
      senderName: 'Operador',
      type: 'text',
      content: text,
      timestamp: new Date().toISOString(),
      isInternalNote: false,
      deliveryStatus: receipt?.status || 'queued',
    };
  },

  /**
   * Request human handoff via canonical POST /conversations/{id}/handoffs
   */
  async requestHandoff(
    conversationId: string,
    reason: HandoffReason = 'explicit_request',
    expectedConversationVersion = 1,
    context: string | null = null,
    idempotencyKey?: string,
    options?: RequestOptions
  ) {
    const key = idempotencyKey || newIdempotencyKey();

    if (USE_MOCK_DATA) {
      const index = localConversations.findIndex((c) => c.id === conversationId);
      if (index !== -1) {
        localConversations[index] = {
          ...localConversations[index],
          status: 'human_pending',
          handoffRequestedAt: new Date().toISOString(),
        };
      }
      return localConversations[index];
    }

    return endpoints.createHandoff(
      conversationId,
      {
        reason,
        context,
        expected_conversation_version: expectedConversationVersion,
      },
      key,
      undefined,
      options
    );
  },

  /**
   * Claim human handoff via canonical POST /handoffs/{handoff_id}/claim
   */
  async claimHandoff(
    handoffId: string,
    assignedUserId: UUID,
    expectedVersion = 1,
    idempotencyKey?: string,
    options?: RequestOptions
  ) {
    const key = idempotencyKey || newIdempotencyKey();
    return endpoints.claimHandoff(
      handoffId,
      {
        assigned_user_id: assignedUserId,
        expected_version: expectedVersion,
      },
      key,
      undefined,
      options
    );
  },

  /**
   * Resolve human handoff via canonical POST /handoffs/{handoff_id}/resolve
   */
  async resolveHandoff(
    handoffId: string,
    action: 'resume_bot' | 'close',
    resolution: string,
    expectedVersion = 1,
    idempotencyKey?: string,
    options?: RequestOptions
  ) {
    const key = idempotencyKey || newIdempotencyKey();
    return endpoints.resolveHandoff(
      handoffId,
      {
        action,
        resolution,
        expected_version: expectedVersion,
      },
      key,
      undefined,
      options
    );
  },

  /**
   * UX Takeover Helper: maps UI button to canonical handoff claim or create+claim.
   */
  async takeoverConversation(
    conversationId: string,
    operatorUserId: UUID,
    handoffId?: string,
    expectedVersion = 1
  ): Promise<ConversationSummary> {
    if (USE_MOCK_DATA) {
      const index = localConversations.findIndex((c) => c.id === conversationId);
      if (index === -1) throw new Error('Conversation not found');
      const updated: ConversationSummary = {
        ...localConversations[index],
        status: 'human_active',
        assignedOperatorName: 'Operador en Turno',
      };
      localConversations[index] = updated;
      return Promise.resolve(updated);
    }

    let targetHandoffId = handoffId;
    if (!targetHandoffId) {
      const handoff = await this.requestHandoff(conversationId, 'explicit_request', expectedVersion);
      targetHandoffId = handoff.id;
    }

    await this.claimHandoff(targetHandoffId, operatorUserId, expectedVersion);
    const updatedConv = await endpoints.getConversationById(conversationId);
    return mapDtoConversationToViewModel(updatedConv);
  },

  /**
   * UX Return-to-bot Helper: maps UI button to canonical handoff resolve with action: resume_bot.
   */
  async returnToBot(
    conversationId: string,
    handoffId?: string,
    expectedVersion = 1
  ): Promise<ConversationSummary> {
    if (USE_MOCK_DATA) {
      const index = localConversations.findIndex((c) => c.id === conversationId);
      if (index === -1) throw new Error('Conversation not found');
      const updated: ConversationSummary = {
        ...localConversations[index],
        status: 'bot_active',
        assignedOperatorName: undefined,
      };
      localConversations[index] = updated;
      return Promise.resolve(updated);
    }

    if (handoffId) {
      await this.resolveHandoff(
        handoffId,
        'resume_bot',
        'Atención humana finalizada. Retoma el asistente virtual.',
        expectedVersion
      );
    }

    const updatedConv = await endpoints.getConversationById(conversationId);
    return mapDtoConversationToViewModel(updatedConv);
  },
};
