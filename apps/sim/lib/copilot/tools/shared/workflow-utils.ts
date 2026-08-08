import { sanitizeWorkflowForSharing } from '@/lib/workflows/credentials/credential-extractor'
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

type CopilotWorkflowProjectionOptions = CopilotSanitizationOptions & { secretless?: boolean }

export function projectWorkflowStateForCopilot<T extends CopilotWorkflowState>(
  state: T,
  options?: CopilotWorkflowProjectionOptions
): T {
  return options?.secretless
    ? (sanitizeWorkflowForSharing(state, {
        preserveEnvVars: false,
        preserveWorkspaceReferences: true,
      }) as T)
    : state
}

export function formatWorkflowStateForCopilot(
  state: CopilotWorkflowState,
  options?: CopilotWorkflowProjectionOptions
): string {
  const workflowState = {
    blocks: state.blocks || {},
    edges: state.edges || [],
    loops: state.loops || {},
    parallels: state.parallels || {},
  }
  const credentialSafeState = projectWorkflowStateForCopilot(workflowState, options)
  const sanitized = sanitizeForCopilot(credentialSafeState as typeof workflowState, options)
  return JSON.stringify(sanitized, null, 2)
}

export function formatNormalizedWorkflowForCopilot(
  normalized: CopilotWorkflowState | null | undefined,
  options?: CopilotWorkflowProjectionOptions
): string | null {
  if (!normalized) return null
  return formatWorkflowStateForCopilot(normalized, options)
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
