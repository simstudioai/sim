import {
  type CopilotSanitizationOptions,
  sanitizeForCopilot,
} from '@/lib/workflows/sanitization/json-sanitizer'

type CopilotWorkflowState = {
  blocks?: Record<string, any>
  edges?: any[]
  loops?: Record<string, any>
  parallels?: Record<string, any>
}

export function formatWorkflowStateForCopilot(
  state: CopilotWorkflowState,
  options?: CopilotSanitizationOptions
): string {
  const workflowState = {
    blocks: state.blocks || {},
    edges: state.edges || [],
    loops: state.loops || {},
    parallels: state.parallels || {},
  }
  const sanitized = sanitizeForCopilot(workflowState, options)
  return JSON.stringify(sanitized, null, 2)
}

export function formatNormalizedWorkflowForCopilot(
  normalized: CopilotWorkflowState | null | undefined,
  options?: CopilotSanitizationOptions
): string | null {
  if (!normalized) return null
  return formatWorkflowStateForCopilot(normalized, options)
}
