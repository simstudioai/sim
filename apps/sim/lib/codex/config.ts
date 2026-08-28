import {
  CODEX_MODELS,
  CODEX_REASONING_EFFORTS,
  type CodexModel,
  type CodexReasoningEffort,
  DEFAULT_CODEX_MODEL,
} from '@/providers/codex'

export const CODEX_CONFIG_VERSION = 1 as const

export const CODEX_MODES = ['cloud_plan', 'cloud'] as const
export type CodexMode = (typeof CODEX_MODES)[number]

/** Fields whose stable values can be inherited across Codex configuration layers. */
export interface CodexConfigPatch {
  mode?: CodexMode
  model?: CodexModel
  owner?: string
  repo?: string
  /** `null` explicitly chooses the repository default branch instead of inheriting one. */
  baseBranch?: string | null
  reasoningEffort?: CodexReasoningEffort
  networkAccess?: boolean
}

export type CodexConfigField = keyof CodexConfigPatch

/** One workflow overlay: defaults first, then a patch per reusable logical Agent. */
export interface CodexWorkflowConfig {
  version: typeof CODEX_CONFIG_VERSION
  defaults: CodexConfigPatch
  agents: Record<string, CodexConfigPatch>
}

export type CodexConfigSource =
  | 'system'
  | 'workspace'
  | 'workflow'
  | 'legacy-step'
  | 'agent'
  | 'step'

export interface ResolvedCodexConfig {
  mode: CodexMode
  model: CodexModel
  owner?: string
  repo?: string
  baseBranch?: string
  reasoningEffort: CodexReasoningEffort
  networkAccess: boolean
}

export type CodexConfigProvenance = Record<keyof ResolvedCodexConfig, CodexConfigSource>

export interface CodexConfigResolution {
  config: ResolvedCodexConfig
  provenance: CodexConfigProvenance
}

export interface ResolveCodexConfigOptions {
  workspace?: CodexConfigPatch
  workflow?: CodexConfigPatch
  /** Compatibility bridge for workflows authored before shared configuration existed. */
  legacyStep?: CodexConfigPatch
  /** Hidden copy payload retained when a block is cloned into a fresh logical Agent. */
  embeddedAgent?: CodexConfigPatch
  agent?: CodexConfigPatch
  /** Only genuinely step-scoped overrides, currently reasoning effort. */
  step?: CodexConfigPatch
}

export const SYSTEM_CODEX_CONFIG: ResolvedCodexConfig = {
  mode: 'cloud_plan',
  model: DEFAULT_CODEX_MODEL,
  reasoningEffort: 'medium',
  networkAccess: false,
}

const CONFIG_FIELDS = [
  'mode',
  'model',
  'owner',
  'repo',
  'baseBranch',
  'reasoningEffort',
  'networkAccess',
] as const satisfies readonly CodexConfigField[]

const CODEX_MODE_SET = new Set<string>(CODEX_MODES)
const CODEX_MODEL_SET = new Set<string>(CODEX_MODELS)
const CODEX_REASONING_EFFORT_SET = new Set<string>(CODEX_REASONING_EFFORTS)
export const CODEX_AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

/**
 * Parses untrusted JSON into a sparse patch. Unknown keys are ignored while an
 * invalid value for a known key is rejected, so broken stored config cannot be
 * mistaken for a valid inherited default.
 */
export function parseCodexConfigPatch(value: unknown): CodexConfigPatch {
  if (value === undefined || value === null) return {}
  if (!isRecord(value)) throw new Error('Codex configuration must be an object')

  const patch: CodexConfigPatch = {}

  if (Object.hasOwn(value, 'mode')) {
    if (typeof value.mode !== 'string' || !CODEX_MODE_SET.has(value.mode)) {
      throw new Error(`Unsupported Codex mode "${String(value.mode)}"`)
    }
    patch.mode = value.mode as CodexMode
  }

  if (Object.hasOwn(value, 'model')) {
    if (typeof value.model !== 'string' || !CODEX_MODEL_SET.has(value.model)) {
      throw new Error(`Unsupported Codex model "${String(value.model)}"`)
    }
    patch.model = value.model as CodexModel
  }

  for (const field of ['owner', 'repo'] as const) {
    if (!Object.hasOwn(value, field)) continue
    const parsed = optionalTrimmedString(value[field])
    if (!parsed) throw new Error(`Codex ${field} cannot be blank`)
    patch[field] = parsed
  }

  if (Object.hasOwn(value, 'baseBranch')) {
    if (value.baseBranch === null) patch.baseBranch = null
    else {
      const parsed = optionalTrimmedString(value.baseBranch)
      if (!parsed) throw new Error('Codex baseBranch must be a non-empty string or null')
      patch.baseBranch = parsed
    }
  }

  if (Object.hasOwn(value, 'reasoningEffort')) {
    if (
      typeof value.reasoningEffort !== 'string' ||
      !CODEX_REASONING_EFFORT_SET.has(value.reasoningEffort)
    ) {
      throw new Error(`Unsupported Codex reasoning effort "${String(value.reasoningEffort)}"`)
    }
    patch.reasoningEffort = value.reasoningEffort as CodexReasoningEffort
  }

  if (Object.hasOwn(value, 'networkAccess')) {
    if (typeof value.networkAccess !== 'boolean') {
      throw new Error('Codex networkAccess must be a boolean')
    }
    patch.networkAccess = value.networkAccess
  }

  return patch
}

/** Parses both current and absent/legacy workflow configuration documents. */
export function parseCodexWorkflowConfig(value: unknown): CodexWorkflowConfig {
  if (value === undefined || value === null) {
    return { version: CODEX_CONFIG_VERSION, defaults: {}, agents: {} }
  }
  if (!isRecord(value)) throw new Error('Codex workflow configuration must be an object')
  if (Object.hasOwn(value, 'version') && value.version !== CODEX_CONFIG_VERSION) {
    throw new Error(`Unsupported Codex configuration version "${String(value.version)}"`)
  }

  const rawDefaults = Object.hasOwn(value, 'defaults') ? value.defaults : {}
  const rawAgents = Object.hasOwn(value, 'agents') ? value.agents : {}
  if (!isRecord(rawAgents)) throw new Error('Codex workflow agents must be an object')
  if (Object.keys(rawAgents).length > 100) {
    throw new Error('A workflow can configure at most 100 Codex agents')
  }

  const agents: Record<string, CodexConfigPatch> = {}
  for (const [agentId, patch] of Object.entries(rawAgents)) {
    if (!CODEX_AGENT_ID_PATTERN.test(agentId))
      throw new Error(`Invalid Codex Agent ID "${agentId}"`)
    agents[agentId] = parseCodexConfigPatch(patch)
  }

  return {
    version: CODEX_CONFIG_VERSION,
    defaults: parseCodexConfigPatch(rawDefaults),
    agents,
  }
}

function applyPatch(
  config: ResolvedCodexConfig,
  provenance: CodexConfigProvenance,
  patch: CodexConfigPatch | undefined,
  source: CodexConfigSource
): void {
  if (!patch) return
  for (const field of CONFIG_FIELDS) {
    if (!Object.hasOwn(patch, field)) continue
    const value = patch[field]
    if (field === 'baseBranch' && value === null) config.baseBranch = undefined
    else if (value !== undefined) Object.assign(config, { [field]: value })
    provenance[field] = source
  }
}

/**
 * Strategic-merge style overlay. Missing keys inherit; `false` remains an
 * explicit boolean override; `baseBranch: null` deliberately clears a parent.
 */
export function resolveCodexConfig({
  workspace,
  workflow,
  legacyStep,
  embeddedAgent,
  agent,
  step,
}: ResolveCodexConfigOptions): CodexConfigResolution {
  const config: ResolvedCodexConfig = { ...SYSTEM_CODEX_CONFIG }
  const provenance: CodexConfigProvenance = {
    mode: 'system',
    model: 'system',
    owner: 'system',
    repo: 'system',
    baseBranch: 'system',
    reasoningEffort: 'system',
    networkAccess: 'system',
  }

  // Legacy values are a migration fallback, not a new authoring layer. Any
  // explicit shared overlay supersedes them so workspace-wide edits also fix
  // workflows created before layered configuration existed.
  applyPatch(config, provenance, legacyStep, 'legacy-step')
  applyPatch(config, provenance, workspace, 'workspace')
  applyPatch(config, provenance, workflow, 'workflow')
  applyPatch(config, provenance, embeddedAgent, 'agent')
  applyPatch(config, provenance, agent, 'agent')
  applyPatch(config, provenance, step, 'step')

  return { config, provenance }
}

/** Removes empty Agent patches so deleting the final override deletes the layer too. */
export function compactCodexWorkflowConfig(config: CodexWorkflowConfig): CodexWorkflowConfig {
  return {
    version: CODEX_CONFIG_VERSION,
    defaults: { ...config.defaults },
    agents: Object.fromEntries(
      Object.entries(config.agents)
        .filter(([, patch]) => Object.keys(patch).length > 0)
        .map(([agentId, patch]) => [agentId, { ...patch }])
    ),
  }
}

/** Remaps default Agent identities that are block IDs when a workflow is copied. */
export function remapCodexWorkflowAgentIds(
  value: unknown,
  blockIdMap: ReadonlyMap<string, string>
): CodexWorkflowConfig {
  const config = parseCodexWorkflowConfig(value)
  const agents: Record<string, CodexConfigPatch> = {}
  for (const [agentId, patch] of Object.entries(config.agents)) {
    const targetId = blockIdMap.get(agentId) ?? agentId
    agents[targetId] = { ...(agents[targetId] ?? {}), ...patch }
  }
  return compactCodexWorkflowConfig({ ...config, agents })
}
