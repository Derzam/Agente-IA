import OpenAI from "openai";
import type {
  ResponseInputItem,
  ResponseOutputItem,
  FunctionTool,
} from "openai/resources/responses/responses.js";
import { toResponseInputItems } from "openai/lib/responses/ResponseInputItems";
export type InputItem = ResponseInputItem;
export interface AiReply {
  items: ResponseInputItem[];
  calls: { name: string; arguments: string; call_id: string }[];
  text: string;
  input: number;
  output: number;
}
export interface AiProvider {
  respond(input: InputItem[], tools: FunctionTool[]): Promise<AiReply>;
}
export class ProviderFailure extends Error {
  constructor(
    readonly code: string,
    readonly retryable = false,
  ) {
    super(code);
  }
}
export class ResponsesProvider implements AiProvider {
  private client: OpenAI;
  constructor(
    private config: {
      apiKey: string;
      model: string;
      maxOutput: number;
      timeout: number;
    },
    fetcher?: typeof fetch,
  ) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      maxRetries: 0,
      timeout: config.timeout,
      ...(fetcher ? { fetch: fetcher } : {}),
    });
  }
  async respond(input: InputItem[], tools: FunctionTool[]): Promise<AiReply> {
    try {
      const r = await this.client.responses.create(
        {
          model: this.config.model,
          input,
          tools,
          parallel_tool_calls: false,
          max_output_tokens: this.config.maxOutput,
          store: false,
          include: ["reasoning.encrypted_content"],
        },
        { timeout: this.config.timeout },
      );
      if (r.status !== "completed" || !r.usage)
        throw new ProviderFailure("AI_INCOMPLETE");
      const unsupported = r.output.some(
        (v) => !["message", "function_call", "reasoning"].includes(v.type),
      );
      if (unsupported) throw new ProviderFailure("AI_INVALID_OUTPUT");
      return {
        items: toResponseInputItems(r.output),
        calls: r.output
          .filter((v) => v.type === "function_call")
          .map((v) => ({
            name: v.name,
            arguments: v.arguments,
            call_id: v.call_id,
          })),
        text: r.output_text,
        input: r.usage.input_tokens,
        output: r.usage.output_tokens,
      };
    } catch (e) {
      if (e instanceof ProviderFailure) throw e;
      if (e instanceof OpenAI.APIConnectionTimeoutError)
        throw new ProviderFailure("AI_TIMEOUT", true);
      if (e instanceof OpenAI.APIError)
        throw new ProviderFailure(
          e.status === 429 ? "AI_RATE_LIMITED" : "AI_PROVIDER_ERROR",
          e.status === 429 || (!!e.status && e.status >= 500),
        );
      throw new ProviderFailure("AI_PROVIDER_ERROR", true);
    }
  }
}
