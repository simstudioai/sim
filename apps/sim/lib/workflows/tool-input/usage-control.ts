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
