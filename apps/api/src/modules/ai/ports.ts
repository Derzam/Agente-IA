import type { CustomerContext } from "../domain/application/ordering.js";
export interface Turn {
  id: string;
  inbound: string;
  ctx: CustomerContext;
  kind: string;
  text: string;
  prior?: string;
}
export interface AiPersistence {
  start(tenant: string, inbound: string, model: string): Promise<Turn | null>;
  check(turn: Turn): Promise<boolean>;
  attempt(turn: Turn): Promise<void>;
  usage(turn: Turn, input: number, output: number): Promise<void>;
  toolStart(
    turn: Turn,
    sequence: number,
    name: string,
    hash: string,
  ): Promise<string>;
  toolFinish(
    turn: Turn,
    id: string,
    duration: number,
    code?: string,
    resource?: string,
  ): Promise<void>;
  outbound(turn: Turn, text: string): Promise<void>;
  finish(turn: Turn, code?: string): Promise<void>;
}
