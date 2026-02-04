import { sanitizeForCopilot } from '@/lib/workflows/sanitization/json-sanitizer'

type CopilotWorkflowState = {
  blocks?: Record<string, any>
  edges?: any[]
  loops?: Record<string, any>
  parallels?: Record<string, any>
}

export function formatWorkflowStateForCopilot(state: CopilotWorkflowState): string {
  const workflowState = {
    blocks: state.blocks || {},
    edges: state.edges || [],
    loops: state.loops || {},
    parallels: state.parallels || {},
  }
  const sanitized = sanitizeForCopilot(workflowState)
  return JSON.stringify(sanitized, null, 2)
}

export function formatNormalizedWorkflowForCopilot(
  normalized: CopilotWorkflowState | null | undefined
): string | null {
  if (!normalized) return null
  return formatWorkflowStateForCopilot(normalized)
}

export function normalizeWorkflowName(name?: string | null): string {
  return String(name || '')
    .trim()
    .toLowerCase()
}

export function extractWorkflowNames(workflows: Array<{ name?: string | null }>): string[] {
  return workflows
    .map((workflow) => (typeof workflow?.name === 'string' ? workflow.name : null))
    .filter((name): name is string => Boolean(name))
}
