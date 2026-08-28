/** Catalog contract baked into the pinned Codex sandbox image. */

export const CODEX_CLI_VERSION = '0.146.0'

/** Models visible and API-capable in Codex 0.146.0's bundled catalog. */
export const CODEX_MODELS = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.2',
] as const

export type CodexModel = (typeof CODEX_MODELS)[number]
export const DEFAULT_CODEX_MODEL: CodexModel = CODEX_MODELS[0]

export const CODEX_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number]

const CODEX_MODEL_SET = new Set<string>(CODEX_MODELS)
const CODEX_REASONING_EFFORT_SET = new Set<string>(CODEX_REASONING_EFFORTS)

/** Resolves and validates a model against the catalog baked into the pinned CLI. */
export function parseCodexModel(value: unknown): CodexModel {
  const model = typeof value === 'string' ? value.trim() : ''
  if (!model) return DEFAULT_CODEX_MODEL
  if (CODEX_MODEL_SET.has(model)) return model as CodexModel
  throw new Error(`Unsupported Codex model "${model}". Use one of: ${CODEX_MODELS.join(', ')}.`)
}

/** Resolves a supported reasoning effort, defaulting to the model's medium tier. */
export function parseCodexReasoningEffort(value: unknown): CodexReasoningEffort {
  const effort = typeof value === 'string' ? value.trim() : ''
  if (!effort) return 'medium'
  if (CODEX_REASONING_EFFORT_SET.has(effort)) return effort as CodexReasoningEffort
  throw new Error(
    `Unsupported Codex reasoning effort "${effort}". Use one of: ${CODEX_REASONING_EFFORTS.join(', ')}.`
  )
}
