import type pg from "pg";
import type { RuntimeConfig } from "../config/runtime.js";
import { InternalWorker } from "./internal-worker.js";
import { RuntimeSafety, rate, scoped } from "../platform/runtime-safety.js";
import { Orchestrator } from "../modules/ai/orchestrator.js";
import { ResponsesProvider, type AiProvider } from "../modules/ai/provider.js";
import { ToolExecutor } from "../modules/ai/tools.js";
import {
  PostgresAiPersistence,
  EncryptedQuoteTransport,
} from "../modules/ai/persistence.js";
import { OrderingService } from "../modules/domain/application/ordering.js";
import { ChallengeCipher } from "../providers/meta/challenge-cipher.js";
import {
  CloudMetaProvider,
  type MetaProvider,
} from "../providers/meta/provider.js";
import {
  MetaDispatcher,
  reconcileStatus,
} from "../providers/meta/dispatcher.js";
import { AppError } from "../platform/errors.js";
export class RuntimeWorker {
  readonly internal: InternalWorker;
  readonly store: PostgresAiPersistence;
  readonly ai?: Orchestrator;
  readonly dispatcher?: MetaDispatcher;
  private cursor = "00000000-0000-0000-0000-000000000000";
  private jobCursor = this.cursor;
  private jobs = new Map<string, Promise<void>>();
  constructor(
    private pool: pg.Pool,
    private config: RuntimeConfig,
    private observe: (v: Record<string, unknown>) => void = () => {},
    providers?: { ai?: AiProvider; meta?: MetaProvider },
  ) {
    const safety = new RuntimeSafety(pool, config.budget);
    this.store = new PostgresAiPersistence(pool);
    const cipher =
      config.aiEnabled || config.metaEnabled
        ? new ChallengeCipher(config.challenge.active, config.challenge.keys)
        : undefined;
    this.internal = new InternalWorker(pool, 5, 30, observe, {
      status: reconcileStatus,
      confirmed: config.aiEnabled
        ? (r, ctx, order, inbound) =>
            this.store.confirmedWithin(r, ctx, order, inbound)
        : undefined,
      inbound: async (r, customer) => {
        if (
          !(await rate(r, "inbound", "tenant", 600)) ||
          !(await rate(r, "inbound", customer, 30))
        )
          throw new AppError(429, "RATE_LIMITED", "Límite inbound.", true);
      },
    });
    if (config.aiEnabled)
      this.ai = new Orchestrator(
        providers?.ai ?? new ResponsesProvider(config.openai),
        this.store,
        new ToolExecutor(
          new OrderingService(pool, new EncryptedQuoteTransport(cipher!)),
        ),
        safety,
        config,
        observe,
      );
    if (config.metaEnabled)
      this.dispatcher = new MetaDispatcher(
        pool,
        providers?.meta ?? new CloudMetaProvider(config.meta),
        cipher!,
        config,
        safety,
      );
  }
  async tick() {
    let tenants = (
      await this.pool.query(
        "SELECT id FROM app.businesses WHERE id>$1 ORDER BY id LIMIT 20",
        [this.cursor],
      )
    ).rows;
    if (!tenants.length) {
      this.cursor = "00000000-0000-0000-0000-000000000000";
      tenants = (
        await this.pool.query(
          "SELECT id FROM app.businesses ORDER BY id LIMIT 20",
        )
      ).rows;
    }
    let completed = 0;
    for (const t of tenants) {
      this.cursor = t.id;
      for (const queue of ["inbox", "outbox"] as const) {
        const lease = await this.internal.claim(t.id, queue);
        if (lease && (await this.internal.process(lease))) completed++;
      }
    }
    // External calls never hold the polling loop or a DB transaction. A tenant gets at most one slot.
    const candidates =
      this.ai || this.dispatcher
        ? [...tenants].sort(
            (a, b) =>
              Number(a.id <= this.jobCursor) - Number(b.id <= this.jobCursor) ||
              a.id.localeCompare(b.id),
          )
        : [];
    let scheduled = 0;
    for (const t of candidates) {
      if (this.jobs.size >= 4) break;
      if (this.jobs.has(t.id)) continue;
      this.jobCursor = t.id;
      const job = (async () => {
        if (this.ai) {
          const inbound = await this.store.pending(t.id);
          if (inbound) await this.ai.run(t.id, inbound);
        }
        if (this.dispatcher) await this.dispatcher.tick(t.id);
      })()
        .catch(() =>
          this.observe({
            event_type: "worker.runtime_failed",
            business_id: t.id,
            error_code: "RUNTIME_JOB_FAILED",
          }),
        )
        .finally(() => this.jobs.delete(t.id));
      this.jobs.set(t.id, job);
      scheduled++;
    }
    return {
      tenants: tenants.length,
      completed,
      scheduled,
      in_flight: this.jobs.size,
    };
  }
  async drain() {
    await Promise.allSettled([...this.jobs.values()]);
  }
}
