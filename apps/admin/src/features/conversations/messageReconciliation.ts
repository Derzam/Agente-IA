import type { ChatMessage } from '@/types/viewModels';

/**
 * Reconciles canonical messages with optimistic 202 receipts.
 * Queued receipts are scoped to the active conversation and removed once the
 * persisted message exposing the same outbox_id is returned by polling.
 */
export function reconcileConversationMessages(
  previous: ChatMessage[],
  incoming: ChatMessage[],
  conversationId: string
): ChatMessage[] {
  const incomingIds = new Set(incoming.map((message) => message.id));
  const confirmedOutboxIds = new Set(
    incoming
      .map((message) => message.outboxId)
      .filter((outboxId): outboxId is string => Boolean(outboxId))
  );

  const queued = previous.filter((message) => {
    if (message.conversationId !== conversationId || message.deliveryStatus !== 'queued') {
      return false;
    }
    if (incomingIds.has(message.id)) {
      return false;
    }

    const optimisticOutboxId = message.outboxId ?? message.id;
    return !confirmedOutboxIds.has(optimisticOutboxId);
  });

  return [...incoming, ...queued];
}
