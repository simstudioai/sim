// GENERATED — do not edit. Source of truth: mothership worker packages/contracts/src/metrics-v1.ts
// Regenerate with `bun run contracts:sync` in the worker.

// Canonical mothership OTel metric names Sim emits. Names only: label keys and histogram
// buckets are the emitter's.

export const Metric = {
  CopilotBillingLongContextCount: "copilot.billing.long_context.count",
  CopilotCacheAttempted: "copilot.cache.attempted",
  CopilotCacheHit: "copilot.cache.hit",
  CopilotCacheWrite: "copilot.cache.write",
  CopilotChatBlobBytes: "copilot.chat.blob.bytes",
  CopilotChatBlobCount: "copilot.chat.blob.count",
  CopilotDegradedCount: "copilot.degraded.count",
  CopilotFileReadDuration: "copilot.file.read.duration",
  CopilotFileReadSize: "copilot.file.read.size",
  CopilotMessagesSerializeDuration: "copilot.messages.serialize.duration",
  CopilotOptionsEmittedCount: "copilot.options.emitted.count",
  CopilotPromptComponentChars: "copilot.prompt.component.chars",
  CopilotRequestCount: "copilot.request.count",
  CopilotRequestDuration: "copilot.request.duration",
  CopilotToolCalls: "copilot.tool.calls",
  CopilotToolDuration: "copilot.tool.duration",
  CopilotVfsDelta: "copilot.vfs.delta",
  CopilotVfsMaterializeDuration: "copilot.vfs.materialize.duration",
  GenAiClientCacheTokenUsage: "gen_ai.client.cache.token.usage",
  GenAiClientTokenUsage: "gen_ai.client.token.usage",
  LlmClientCompactions: "llm.client.compactions",
  LlmClientContextTokens: "llm.client.context_tokens",
  LlmClientErrors: "llm.client.errors",
  LlmClientOutputCutoff: "llm.client.output_cutoff",
  LlmClientStreamDuration: "llm.client.stream.duration",
  LlmClientTimeToFirstToken: "llm.client.time_to_first_token",
} as const;

export type MetricKey = keyof typeof Metric;
export type MetricValue = (typeof Metric)[MetricKey];

/** Readonly sorted list of every canonical mothership metric name. */
export const MetricValues: readonly MetricValue[] = [
  "copilot.billing.long_context.count",
  "copilot.cache.attempted",
  "copilot.cache.hit",
  "copilot.cache.write",
  "copilot.chat.blob.bytes",
  "copilot.chat.blob.count",
  "copilot.degraded.count",
  "copilot.file.read.duration",
  "copilot.file.read.size",
  "copilot.messages.serialize.duration",
  "copilot.options.emitted.count",
  "copilot.prompt.component.chars",
  "copilot.request.count",
  "copilot.request.duration",
  "copilot.tool.calls",
  "copilot.tool.duration",
  "copilot.vfs.delta",
  "copilot.vfs.materialize.duration",
  "gen_ai.client.cache.token.usage",
  "gen_ai.client.token.usage",
  "llm.client.compactions",
  "llm.client.context_tokens",
  "llm.client.errors",
  "llm.client.output_cutoff",
  "llm.client.stream.duration",
  "llm.client.time_to_first_token",
] as const;
