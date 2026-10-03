import type {
  Conversation as DTOConversation,
  Message as DTOMessage,
  HumanHandoff as DTOHumanHandoff,
} from '@agente-ia/shared';
import type {
  ConversationSummary as ViewModelConversationSummary,
  ChatMessage as ViewModelChatMessage,
  MessageSender,
  MessageContentType,
} from '@/types/viewModels';

/**
 * Maps DTO Message to ViewModel ChatMessage.
 * Safe rendering: content is plain text, never raw HTML.
 */
export function mapDtoMessageToViewModel(dto: DTOMessage): ViewModelChatMessage {
  let sender: MessageSender = 'bot';
  if (dto.actor_type === 'customer') sender = 'customer';
  else if (dto.actor_type === 'human') sender = 'staff';
  else if (dto.actor_type === 'system') sender = 'system';

  let type: MessageContentType = 'text';
  if (dto.kind === 'location') type = 'location';

  return {
    id: dto.id,
    conversationId: dto.conversation_id,
    sender,
    senderName:
      sender === 'customer'
        ? 'Cliente'
        : sender === 'staff'
        ? 'Operador'
        : sender === 'bot'
        ? 'Asistente IA'
        : 'Sistema',
    type,
    content: dto.text || (dto.kind === 'location' ? '📍 Ubicación compartida' : ''),
    timestamp: dto.created_at,
    isInternalNote: false,
  };
}

/**
 * Maps canonical DTO Conversation, related handoff and latest message to presentation ConversationSummary.
 */
export function mapDtoConversationToViewModel(
  conv: DTOConversation,
  options?: {
    customer?: { name?: string; phone_masked?: string };
    lastMessage?: DTOMessage;
    handoff?: DTOHumanHandoff;
    activeOrderId?: string;
  }
): ViewModelConversationSummary {
  const lastMessageText = options?.lastMessage?.text || 'Conversación iniciada';
  const lastMessageTime = options?.lastMessage?.created_at || conv.last_customer_message_at || conv.updated_at;

  return {
    id: conv.id,
    version: conv.version,
    customerName: options?.customer?.name || 'Cliente WhatsApp',
    customerPhone: options?.customer?.phone_masked || '+593 9** *** ***',
    status: conv.status,
    lastMessageSnippet: lastMessageText,
    lastMessageTime,
    unreadCount: conv.status === 'human_pending' ? 1 : 0,
    assignedOperatorId: conv.assigned_user_id || undefined,
    assignedOperatorName: conv.assigned_user_id ? 'Operador Asignado' : undefined,
    activeOrderId: options?.activeOrderId,
    handoffId: options?.handoff?.id,
    handoffRequestedAt: options?.handoff?.created_at,
  };
}
