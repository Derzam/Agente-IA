import { setTimeout as delay } from "node:timers/promises";
import type { RuntimeConfig } from "../../config/runtime.js";
import { digest } from "../../platform/idempotency.js";
import type { RuntimeSafety } from "../../platform/runtime-safety.js";
import type { AiPersistence, Turn } from "./ports.js";
import {
  ProviderFailure,
  type AiProvider,
  type InputItem,
} from "./provider.js";
import { toolRegistry, validateTool, ToolExecutor } from "./tools.js";
import { buildContext, renderTool, safeUtterances } from "./context.js";
export class Orchestrator {
  constructor(
    private provider: AiProvider,
    private store: AiPersistence,
    private executor: ToolExecutor,
    private safety: Pick<RuntimeSafety, "reserve" | "settle" | "circuit">,
    private config: RuntimeConfig,
    private observe: (v: Record<string, unknown>) => void = () => {},
  ) {}
  async run(tenant: string, inbound: string) {
    if (!this.config.aiEnabled) return;
    const turn = await this.store.start(
      tenant,
      inbound,
      this.config.openai.model,
    );
    if (!turn) return;
    let sequence = 0,
      rendered: string | null = null,
      quoted = false;
    const deadline = Date.now() + 90000;
    const check = async () => {
      if (Date.now() + this.config.openai.timeout > deadline)
        throw new ProviderFailure("AI_TIME_LIMIT");
      if (!(await this.store.check(turn)))
        throw new ProviderFailure("AI_EPOCH_CHANGED");
    };
    try {
      const input: InputItem[] = buildContext(turn);
      for (
        let responseCount = 0;
        responseCount < this.config.openai.maxResponses;
        responseCount++
      ) {
        await check();
        if (!(await this.safety.circuit(tenant, "openai")))
          throw new ProviderFailure("AI_CIRCUIT_OPEN");
        const estimate =
          Buffer.byteLength(JSON.stringify([input, toolRegistry])) * 2 + 2048;
        if (estimate > 100000) throw new ProviderFailure("AI_CONTEXT_LIMIT");
        let reply;
        for (let attempt = 0; ; attempt++) {
          await check();
          const reservation = await this.safety.reserve(
            tenant,
            turn.ctx.conversation,
            estimate,
            this.config.openai.maxOutput,
          );
          try {
            await check();
            await this.store.attempt(turn);
            reply = await this.provider.respond(input, toolRegistry);
            await this.safety.settle(
              tenant,
              turn.ctx.conversation,
              reservation,
              estimate,
              this.config.openai.maxOutput,
              reply.input,
              reply.output,
            );
            await this.store.usage(turn, reply.input, reply.output);
            await this.safety.circuit(tenant, "openai", true);
            break;
          } catch (e) {
            const error =
              e instanceof ProviderFailure
                ? e
                : new ProviderFailure("AI_PROVIDER_ERROR");
            await this.safety.circuit(tenant, "openai", false);
            if (!error.retryable || attempt >= this.config.openai.retries)
              throw error;
            await delay(100 * 2 ** attempt);
            if (!(await this.safety.circuit(tenant, "openai")))
              throw new ProviderFailure("AI_CIRCUIT_OPEN");
          }
        }
        await check();
        if (!reply.calls.length) {
          if (!quoted)
            await this.store.outbound(
              turn,
              rendered ??
                (safeUtterances.includes(reply.text)
                  ? reply.text
                  : safeUtterances[0]!),
            );
          await this.store.finish(turn);
          this.observe({
            event_type: "ai.turn_completed",
            business_id: tenant,
            conversation_id: turn.ctx.conversation,
            turn_id: turn.id,
            tool_calls: sequence,
          });
          return;
        }
        if (sequence + reply.calls.length > this.config.openai.maxTools)
          throw new ProviderFailure("AI_TOOL_LIMIT");
        input.push(...reply.items);
        for (const call of reply.calls) {
          await check();
          const args = validateTool(call.name, call.arguments);
          await this.safety.reserve(tenant, turn.ctx.conversation, 0, 0, 1);
          const id = await this.store.toolStart(
              turn,
              sequence++,
              call.name,
              digest(args),
            ),
            started = Date.now();
          let result;
          try {
            await check();
            result = await this.executor.execute(
              call.name,
              args,
              turn.ctx,
              id,
              turn.inbound,
            );
            await this.store.toolFinish(
              turn,
              id,
              Date.now() - started,
              undefined,
              result?.id ?? result?.order?.id,
            );
          } catch (e) {
            await this.store.toolFinish(
              turn,
              id,
              Date.now() - started,
              "AI_TOOL_REJECTED",
            );
            throw e;
          }
          if (call.name === "request_human") {
            await this.store.finish(turn);
            return;
          }
          await check();
          if (call.name === "request_quote") quoted = true;
          rendered = renderTool(call.name, result) ?? rendered;
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(result),
          });
        }
      }
      throw new ProviderFailure("AI_RESPONSE_LIMIT");
    } catch (e) {
      const code = e instanceof ProviderFailure ? e.code : "AI_TOOL_REJECTED";
      await this.store.finish(turn, code);
      this.observe({
        event_type: "ai.turn_failed",
        business_id: tenant,
        conversation_id: turn.ctx.conversation,
        turn_id: turn.id,
        error_code: code,
        tool_calls: sequence,
      });
      if (code !== "AI_EPOCH_CHANGED" && (await this.store.check(turn))) {
        try {
          await this.executor.execute(
            "request_human",
            { reason: "system_failure" },
            { ...turn.ctx, turnId: undefined },
            turn.id,
            turn.inbound,
          );
        } catch {
          /* Deliberately safe: no stale reply and no retry of a mutation. */
        }
      }
    }
  }
}
