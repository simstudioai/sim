import { isRecordLike } from '@sim/utils/object'
import type { CanonicalMode, CanonicalModeOverrides } from '@/lib/workflows/subblocks/visibility'
import type { ToolUsageControl } from '@/providers/types'

export const AGENT_TOOL_USAGE_CONTROL_CANONICAL_ID = 'agentToolUsageControl'
export const DEFAULT_AGENT_TOOL_USAGE_CONTROL = 'auto'

interface AgentToolUsageControlInput {
  usageControl?: unknown
  usageControlExpression?: unknown
}

export function buildAgentToolUsageControlCanonicalKey(toolIndex: number): string {
  return `${toolIndex}:${AGENT_TOOL_USAGE_CONTROL_CANONICAL_ID}`
}

export function getAgentToolUsageControlMode(
  toolIndex: number,
  overrides?: CanonicalModeOverrides
): CanonicalMode {
  return overrides?.[buildAgentToolUsageControlCanonicalKey(toolIndex)] === 'advanced'
    ? 'advanced'
    : 'basic'
}

/**
 * Selects each agent tool's Permission Mode from the fields a serialized tool array supplies: an
 * expression alone selects Variable, and a fixed value alone (or neither) selects Selector. A tool
 * carrying both keeps its current mode, since a round trip includes the dormant alternative.
 * `canonicalModes` must already be keyed by the tools' final positions.
 */
export function applyAgentToolUsageControlModes(
  tools: readonly unknown[],
  canonicalModes: CanonicalModeOverrides | undefined
): Record<string, CanonicalMode> {
  const result: Record<string, CanonicalMode> = {}
  for (const [key, mode] of Object.entries(canonicalModes ?? {})) {
    if (mode) result[key] = mode
  }
  tools.forEach((tool, index) => {
    if (!isRecordLike(tool)) return
    const hasFixedValue = tool.usageControl !== undefined
    const hasExpression = tool.usageControlExpression !== undefined
    if (hasFixedValue && hasExpression) return

    const key = buildAgentToolUsageControlCanonicalKey(index)
    if (hasExpression) {
      result[key] = 'advanced'
    } else {
      delete result[key]
    }
  })
  return result
}

export function resolveAgentToolUsageControl(
  tool: AgentToolUsageControlInput,
  toolIndex: number,
  overrides?: CanonicalModeOverrides
): ToolUsageControl | undefined {
  const mode = getAgentToolUsageControlMode(toolIndex, overrides)
  const rawValue =
    mode === 'advanced'
      ? tool.usageControlExpression
      : (tool.usageControl ?? DEFAULT_AGENT_TOOL_USAGE_CONTROL)

  if (typeof rawValue !== 'string') return undefined

  const normalized = rawValue.trim().toLowerCase()
  return normalized === 'auto' || normalized === 'force' || normalized === 'none'
    ? normalized
    : undefined
}
