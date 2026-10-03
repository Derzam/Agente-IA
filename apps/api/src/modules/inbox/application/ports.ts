import type { NormalizedEvent } from '../domain/inbound-event.js';

export interface IngestResult { inserted: number; duplicates: number; unknownChannels: string[]; businessIds?: string[] }
export interface InboxRepository { ingest(events: NormalizedEvent[]): Promise<IngestResult> }
