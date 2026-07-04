// AUTO-GENERATED FILE. DO NOT EDIT.
//
// Source: copilot/copilot/contracts/metrics-v1.schema.json
// Regenerate with: bun run metrics-contract:generate
//
// Canonical mothership OTel metric names. Call sites should reference
// `Metric.<Identifier>` (e.g. `Metric.CopilotToolDuration`) rather than raw
// string literals, so the Go-side contract is the single source of truth and
// typos become compile errors.
//
// NAMES ONLY. Label keys and histogram bucket boundaries are NOT in this
// contract — Go owns the label-cardinality allowlist and the shared bucket
// constant, and the Sim emitter MUST mirror those by hand so the Go∪Sim metric
// union is queryable as one series set.

export const Metric = {
  CopilotCacheAttempted: 'copilot.cache.attempted',
  CopilotCacheHit: 'copilot.cache.hit',
  CopilotCacheWrite: 'copilot.cache.write',
  CopilotFileReadDuration: 'copilot.file.read.duration',
  CopilotFileReadSize: 'copilot.file.read.size',
  CopilotMessagesSerializeDuration: 'copilot.messages.serialize.duration',
  CopilotRequestCount: 'copilot.request.count',
  CopilotRequestDuration: 'copilot.request.duration',
  CopilotToolCalls: 'copilot.tool.calls',
  CopilotToolDuration: 'copilot.tool.duration',
  CopilotVfsDelta: 'copilot.vfs.delta',
  CopilotVfsMaterializeDuration: 'copilot.vfs.materialize.duration',
  GenAiClientCacheTokenUsage: 'gen_ai.client.cache.token.usage',
  GenAiClientTokenUsage: 'gen_ai.client.token.usage',
  LlmClientCompactions: 'llm.client.compactions',
  LlmClientContextTokens: 'llm.client.context_tokens',
  LlmClientErrors: 'llm.client.errors',
  LlmClientOutputCutoff: 'llm.client.output_cutoff',
  LlmClientStreamDuration: 'llm.client.stream.duration',
  LlmClientTimeToFirstToken: 'llm.client.time_to_first_token',
} as const

export type MetricKey = keyof typeof Metric
export type MetricValue = (typeof Metric)[MetricKey]

/** Readonly sorted list of every canonical mothership metric name. */
export const MetricValues: readonly MetricValue[] = [
  'copilot.cache.attempted',
  'copilot.cache.hit',
  'copilot.cache.write',
  'copilot.file.read.duration',
  'copilot.file.read.size',
  'copilot.messages.serialize.duration',
  'copilot.request.count',
  'copilot.request.duration',
  'copilot.tool.calls',
  'copilot.tool.duration',
  'copilot.vfs.delta',
  'copilot.vfs.materialize.duration',
  'gen_ai.client.cache.token.usage',
  'gen_ai.client.token.usage',
  'llm.client.compactions',
  'llm.client.context_tokens',
  'llm.client.errors',
  'llm.client.output_cutoff',
  'llm.client.stream.duration',
  'llm.client.time_to_first_token',
] as const
