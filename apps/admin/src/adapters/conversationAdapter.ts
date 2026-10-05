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
 * Sanitizes failure code to ensure no raw dumps, tokens, phone numbers, or stacks leak to UI.
 */
export function sanitizeFailureCode(code: unknown): string | null {
  if (typeof code === 'number') {
    return String(code);
  }
  if (typeof code !== 'string') {
    return null;
  }
  const trimmed = code.trim();
  if (!trimmed || trimmed.length > 64) {
    return null;
  }
  // Reject tokens, dumps, stacks, URLs, SQL, or JSON-like payloads
  const forbiddenPatterns = [
    /bearer/i,
    /token/i,
    /secret/i,
    /at\s+[\w.]+\s+\(/i,
    /dump/i,
    /https?:/i,
    /[{}[\]"'\\]/,
  ];
  if (forbiddenPatterns.some((pattern) => pattern.test(trimmed))) {
    return null;
  }
  // Safe alphanumeric / underscores / hyphens / dots
  if (/^[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

const KNOWN_DELIVERY_STATUSES = new Set([
  'queued',
  'pending',
  'sending',
  'sent',
  'delivered',
  'read',
  'failed',
  'unknown',
  'dead_letter',
]);

/**
 * Maps DTO Message to ViewModel ChatMessage.
 * Safe rendering: content is plain text, never raw HTML.
 */
export function mapDtoMessageToViewModel(
  dto: DTOMessage & { failure_code?: string | null; outbox_status?: string | null }
): ViewModelChatMessage {
  let sender: MessageSender = 'bot';
  if (dto.actor_type === 'customer') sender = 'customer';
  else if (dto.actor_type === 'human') sender = 'staff';
  else if (dto.actor_type === 'system') sender = 'system';

  let type: MessageContentType = 'text';
  if (dto.kind === 'location') type = 'location';

  const rawStatus = dto.delivery_status || dto.outbox_status || null;
  const deliveryStatus =
    rawStatus && KNOWN_DELIVERY_STATUSES.has(rawStatus)
      ? (rawStatus as ViewModelChatMessage['deliveryStatus'])
      : rawStatus
      ? 'unknown'
      : null;

  const failureCode = sanitizeFailureCode((dto as any).failure_code);

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
    outboxId: dto.outbox_id ?? null,
    anchorMessageId: null,
    deliveryStatus,
    failureCode,
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
    handoffVersion: options?.handoff?.version,
    handoffReason: options?.handoff?.reason,
    handoffStatus: options?.handoff?.status,
  };
}
