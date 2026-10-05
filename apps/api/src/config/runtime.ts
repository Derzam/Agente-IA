import { ConfigurationError } from "./env.js";
export interface ApiRuntimeConfig {
  cursorKey: string;
  cursorPreviousKey?: string;
}
function validateRuntimeEnvironment(env: NodeJS.ProcessEnv, invalid: string[]) {
  if (env.RUNTIME_ENV === "staging") {
    if (env.SUPABASE_URL !== "https://pqffgbpbreuhivxxctvr.supabase.co")
      invalid.push("SUPABASE_URL");
  } else if (env.RUNTIME_ENV && env.RUNTIME_ENV !== "local")
    invalid.push("RUNTIME_ENV");
}
// The public API must never require or read the worker's credentials.
export function loadApiRuntime(env: NodeJS.ProcessEnv): ApiRuntimeConfig {
  const invalid: string[] = [];
  const cursorKey = env.CURSOR_HMAC_KEY || "",
    cursorPreviousKey = env.CURSOR_HMAC_PREVIOUS_KEY || undefined;
  if (!/^[a-f0-9]{64}$/i.test(cursorKey)) invalid.push("CURSOR_HMAC_KEY");
  if (cursorPreviousKey && !/^[a-f0-9]{64}$/i.test(cursorPreviousKey))
    invalid.push("CURSOR_HMAC_PREVIOUS_KEY");
  validateRuntimeEnvironment(env, invalid);
  if (invalid.length) throw new ConfigurationError(invalid);
  return { cursorKey, cursorPreviousKey };
}
export interface RuntimeConfig {
  aiEnabled: boolean;
  metaEnabled: boolean;
  workerUrl: string;
  openai: {
    apiKey: string;
    model: string;
    maxOutput: number;
    maxTools: number;
    timeout: number;
    maxResponses: number;
    retries: number;
  };
  meta: {
    token: string;
    phone: string;
    version: string;
    timeout: number;
    recipients: string[];
  };
  challenge: { active: string; keys: Record<string, string> };
  budget: {
    windowSeconds: number;
    tenant: { input: number; output: number; responses: number; tools: number };
    conversation: {
      input: number;
      output: number;
      responses: number;
      tools: number;
    };
  };
}
export function loadRuntime(env: NodeJS.ProcessEnv): RuntimeConfig {
  const invalid: string[] = [];
  const flag = (k: string) => {
    const v = env[k] || "false";
    if (!["true", "false"].includes(v)) invalid.push(k);
    return v === "true";
  };
  const num = (k: string, d: number, lo = 1, hi = 10000000) => {
    const v = Number(env[k] || d);
    if (!Number.isSafeInteger(v) || v < lo || v > hi) invalid.push(k);
    return v;
  };
  const aiEnabled = flag("AI_RUNTIME_ENABLED"),
    metaEnabled = flag("META_OUTBOUND_ENABLED");
  const workerUrl = env.WORKER_DATABASE_URL || "";
  try {
    const u = new URL(workerUrl);
    if (
      !["postgres:", "postgresql:"].includes(u.protocol) ||
      !u.username ||
      ["postgres", "service_role", "supabase_admin"].includes(u.username) ||
      (!["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) &&
        u.searchParams.get("sslmode") !== "verify-full")
    )
      throw Error();
  } catch {
    invalid.push("WORKER_DATABASE_URL");
  }
  const openai = {
    apiKey: env.OPENAI_API_KEY || "",
    model: env.OPENAI_MODEL || "",
    maxOutput: num("OPENAI_MAX_OUTPUT_TOKENS", 600, 16, 4096),
    maxTools: num("OPENAI_MAX_TOOL_CALLS", 8, 1, 32),
    timeout: num("OPENAI_TIMEOUT_MS", 15000, 100, 30000),
    maxResponses: num("OPENAI_MAX_RESPONSES", 9, 1, 33),
    retries: num("OPENAI_MAX_RETRIES", 1, 0, 2),
  };
  if (aiEnabled) {
    if (!openai.apiKey) invalid.push("OPENAI_API_KEY");
    if (!/^[A-Za-z0-9._:-]{1,120}$/.test(openai.model))
      invalid.push("OPENAI_MODEL");
  }
  const meta = {
    token: env.META_ACCESS_TOKEN || "",
    phone: env.META_PHONE_NUMBER_ID || "",
    version: env.META_GRAPH_API_VERSION || "",
    timeout: num("META_TIMEOUT_MS", 10000, 100, 30000),
    recipients: (env.META_SANDBOX_RECIPIENTS || "").split(",").filter(Boolean),
  };
  if (metaEnabled) {
    if (!meta.token) invalid.push("META_ACCESS_TOKEN");
    if (!/^\d{5,30}$/.test(meta.phone)) invalid.push("META_PHONE_NUMBER_ID");
    if (!/^v\d{1,3}\.\d{1,2}$/.test(meta.version))
      invalid.push("META_GRAPH_API_VERSION");
    if (
      !meta.recipients.length ||
      meta.recipients.some((v) => !/^\d{7,15}$/.test(v))
    )
      invalid.push("META_SANDBOX_RECIPIENTS");
  }
  const challenge = {
    active: env.CONFIRMATION_ACTIVE_KEY_VERSION || "",
    keys: {} as Record<string, string>,
  };
  if (aiEnabled || metaEnabled) {
    try {
      const parsed = JSON.parse(env.CONFIRMATION_TRANSPORT_KEYS || "");
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        Object.keys(parsed).length > 4
      )
        throw Error();
      for (const [k, v] of Object.entries(parsed)) {
        if (
          !/^[A-Za-z0-9_-]{1,24}$/.test(k) ||
          typeof v !== "string" ||
          !/^[a-f0-9]{64}$/i.test(v)
        )
          throw Error();
        challenge.keys[k] = v;
      }
      if (!challenge.keys[challenge.active]) throw Error();
    } catch {
      invalid.push(
        "CONFIRMATION_TRANSPORT_KEYS",
        "CONFIRMATION_ACTIVE_KEY_VERSION",
      );
    }
  }
  validateRuntimeEnvironment(env, invalid);
  const caps = (scope: string, d: number) => ({
    input: num(`AI_${scope}_INPUT_TOKENS`, d * 100000),
    output: num(`AI_${scope}_OUTPUT_TOKENS`, d * 2000),
    responses: num(`AI_${scope}_RESPONSES`, d * 20),
    tools: num(`AI_${scope}_TOOLS`, d * 50),
  });
  const budget = {
    windowSeconds: num("AI_BUDGET_WINDOW_SECONDS", 3600, 60, 86400),
    tenant: caps("TENANT", 10),
    conversation: caps("CONVERSATION", 1),
  };
  if (invalid.length) throw new ConfigurationError(invalid);
  return {
    aiEnabled,
    metaEnabled,
    workerUrl,
    openai,
    meta,
    challenge,
    budget,
  };
}
