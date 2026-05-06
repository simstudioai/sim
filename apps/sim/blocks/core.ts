/**
 * Canonical list of core sim blocks — the first-party capabilities surfaced
 * at the top of the workflow toolbar and the "Blocks" section of the search
 * modal. Distinct from third-party integrations (`BlockConfig.category === 'tools'`)
 * which render below this list.
 *
 * Add or remove an entry here to control what shows up in both the toolbar
 * and the search modal. Order does not matter — both consumers sort
 * alphabetically.
 *
 * `loop` and `parallel` are subflow primitives, not `BlockConfig` entries —
 * they are still listed here so a single source of truth stays canonical.
 */
export const CORE_BLOCK_TYPES = [
  'agent',
  'api',
  'condition',
  'credential',
  'evaluator',
  'file',
  'function',
  'guardrails',
  'human_in_the_loop',
  'knowledge',
  'logs',
  'loop',
  'memory',
  'mothership',
  'note',
  'parallel',
  'response',
  'router',
  'search',
  'ssh',
  'table',
  'variables',
  'wait',
  'webhook_request',
  'workflow',
  'workflow_input',
] as const

export type CoreBlockType = (typeof CORE_BLOCK_TYPES)[number]

const CORE_BLOCK_TYPE_SET: ReadonlySet<string> = new Set(CORE_BLOCK_TYPES)

/** Strips a trailing `_vN` so versioned blocks (e.g. `router_v2`) match their base name. */
const stripVersionSuffix = (type: string): string => type.replace(/_v\d+$/, '')

export const isCoreBlockType = (type: string): boolean =>
  CORE_BLOCK_TYPE_SET.has(type) || CORE_BLOCK_TYPE_SET.has(stripVersionSuffix(type))
