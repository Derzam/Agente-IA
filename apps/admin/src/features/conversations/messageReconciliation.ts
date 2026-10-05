import type { ChatMessage } from '@/types/viewModels';

/**
 * Normalizes messages into chronological order (created_at / timestamp ASC).
 * Uses ID as a deterministic tie-breaker for identical timestamps.
 * Does not mutate the source array.
 */
export function sortMessagesChronological(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort((a, b) => {
    const timeA = Number.isNaN(Date.parse(a.timestamp)) ? 0 : Date.parse(a.timestamp);
    const timeB = Number.isNaN(Date.parse(b.timestamp)) ? 0 : Date.parse(b.timestamp);
    if (timeA !== timeB) {
      return timeA - timeB;
    }
    return a.id.localeCompare(b.id);
  });
}

/**
 * Reconciles canonical messages with optimistic 202 receipts.
 * - Enforces chronological order (created_at ASC) on incoming messages.
 * - Strictly scopes messages to the active conversationId.
 * - Queued receipts are placed at the end of the transcript.
 * - Once the persisted message exposing the same outbox_id arrives,
 *   the optimistic queued receipt is removed without duplicate.
 */
export function reconcileConversationMessages(
  previous: ChatMessage[],
  incoming: ChatMessage[],
  conversationId: string
): ChatMessage[] {
  const scopedIncoming = incoming.filter((message) => message.conversationId === conversationId);
  const sortedIncoming = sortMessagesChronological(scopedIncoming);

  const incomingIds = new Set(sortedIncoming.map((message) => message.id));
  const confirmedOutboxIds = new Set(
    sortedIncoming
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

  const sortedQueued = sortMessagesChronological(queued);

  return [...sortedIncoming, ...sortedQueued];
}
