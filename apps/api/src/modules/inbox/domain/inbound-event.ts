/** Minimal durable event. No HTTP, SDK or database dependencies. */
export interface NormalizedEvent {
  phoneNumberId: string;
  eventKey: string;
  eventType: 'message' | 'status' | 'unsupported';
  payload: {
    phone_number_id: string;
    provider_message_id: string | null;
    channel_user_id: string | null;
    provider_timestamp: string | null;
    kind: 'text' | 'interactive' | 'location' | 'unsupported' | 'status';
    content: Record<string, unknown>;
  };
  payloadHash: string;
  quarantine: string | null;
}
