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

export const QUEUED_RECEIPT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Reconciles canonical messages with optimistic 202 receipts.
 * - Enforces chronological order (created_at ASC) on incoming messages.
 * - Strictly scopes messages to the active conversationId.
 * - Queued receipts are placed at the end of the transcript.
 * - Once the persisted message exposing the same outbox_id arrives,
 *   the optimistic queued receipt is removed without duplicate.
 * - If a tab was inactive or more than a full page of newer messages arrived,
 *   queued receipts older than the TTL or falling outside the bounded page window (>= 20 messages) are expired.
 */
export function reconcileConversationMessages(
  previous: ChatMessage[],
  incoming: ChatMessage[],
  conversationId: string,
  nowMs = Date.now()
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
    if (confirmedOutboxIds.has(optimisticOutboxId)) {
      return false;
    }

    const msgTime = Number.isNaN(Date.parse(message.timestamp)) ? 0 : Date.parse(message.timestamp);

    // 1. Expire receipts that exceed the TTL on the client clock (e.g., after long inactive tab)
    if (msgTime > 0 && nowMs - msgTime > QUEUED_RECEIPT_TTL_MS) {
      return false;
    }

    // 2. Drop receipts that fall outside the bounded page window using server-derived correlation metadata:
    // If the receipt was anchored to a server message (anchorMessageId) and that anchor is no longer
    // present in a saturated incoming page (>= 20 messages), its position has shifted off the page window.
    if (
      message.anchorMessageId &&
      sortedIncoming.length >= 20 &&
      !incomingIds.has(message.anchorMessageId)
    ) {
      return false;
    }

    return true;
  });

  const sortedQueued = sortMessagesChronological(queued);

  return [...sortedIncoming, ...sortedQueued];
}
