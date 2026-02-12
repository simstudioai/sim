import { createLogger } from '@sim/logger'
import { asRecord } from '@/lib/copilot/orchestrator/sse-utils'
import type { CopilotToolCall } from '@/stores/panel/copilot/types'
import { useVariablesStore } from '@/stores/panel/variables/store'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('CopilotToolEffects')

type ParsedToolEffect = {
  kind: string
  payload: Record<string, unknown>
}

function asNonEmptyRecord(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value)
  return Object.keys(record).length > 0 ? record : null
}

function parseToolEffects(raw: unknown): ParsedToolEffect[] {
  if (!Array.isArray(raw)) return []
  const effects: ParsedToolEffect[] = []
  for (const item of raw) {
    const effect = asRecord(item)
    const kind = typeof effect.kind === 'string' ? effect.kind : ''
    if (!kind) continue
    effects.push({
      kind,
      payload: asRecord(effect.payload) || {},
    })
  }
  return effects
}

function resolveWorkflowId(
  payload: Record<string, unknown>,
  toolCall?: CopilotToolCall
): string | undefined {
  const payloadWorkflowId = typeof payload.workflowId === 'string' ? payload.workflowId : undefined
  if (payloadWorkflowId) return payloadWorkflowId

  const params = asRecord(toolCall?.params)
  const paramWorkflowId = typeof params?.workflowId === 'string' ? params.workflowId : undefined
  if (paramWorkflowId) return paramWorkflowId

  return useWorkflowRegistry.getState().activeWorkflowId || undefined
}

function resolveWorkflowState(
  payload: Record<string, unknown>,
  resultPayload?: Record<string, unknown>
): WorkflowState | null {
  const payloadState = asNonEmptyRecord(payload.workflowState)
  if (payloadState) return payloadState as unknown as WorkflowState

  if (resultPayload) {
    const directState = asNonEmptyRecord(resultPayload.workflowState)
    if (directState) return directState as unknown as WorkflowState
    const editResult = asRecord(resultPayload.editResult)
    const nestedState = asNonEmptyRecord(editResult?.workflowState)
    if (nestedState) return nestedState as unknown as WorkflowState
  }

  return null
}

function applyDeploymentSyncEffect(payload: Record<string, unknown>, toolCall?: CopilotToolCall): void {
  const workflowId = resolveWorkflowId(payload, toolCall)
  if (!workflowId) return

  const registry = useWorkflowRegistry.getState()
  const existingStatus = registry.getWorkflowDeploymentStatus(workflowId)

  const isDeployed =
    typeof payload.isDeployed === 'boolean'
      ? payload.isDeployed
      : (existingStatus?.isDeployed ?? true)

  const deployedAt = (() => {
    if (typeof payload.deployedAt === 'string' && payload.deployedAt) {
      const parsed = new Date(payload.deployedAt)
      if (!Number.isNaN(parsed.getTime())) return parsed
    }
    return existingStatus?.deployedAt
  })()

  const apiKey =
    typeof payload.apiKey === 'string' && payload.apiKey.length > 0
      ? payload.apiKey
      : existingStatus?.apiKey

  registry.setDeploymentStatus(workflowId, isDeployed, deployedAt, apiKey)
}

function applyApiKeySyncEffect(payload: Record<string, unknown>, toolCall?: CopilotToolCall): void {
  const workflowId = resolveWorkflowId(payload, toolCall)
  if (!workflowId) return

  const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey : undefined
  const registry = useWorkflowRegistry.getState()
  const existingStatus = registry.getWorkflowDeploymentStatus(workflowId)
  registry.setDeploymentStatus(
    workflowId,
    existingStatus?.isDeployed ?? false,
    existingStatus?.deployedAt,
    apiKey || existingStatus?.apiKey
  )
}

function applyWorkflowVariablesReload(
  payload: Record<string, unknown>,
  toolCall?: CopilotToolCall
): void {
  const workflowId = resolveWorkflowId(payload, toolCall)
  if (!workflowId) return
  useVariablesStore.getState().loadForWorkflow(workflowId)
}

export function applyToolEffects(params: {
  effectsRaw: unknown
  toolCall?: CopilotToolCall
  resultPayload?: Record<string, unknown>
}): void {
  const effects = parseToolEffects(params.effectsRaw)
  if (effects.length === 0) {
    if (params.toolCall?.name === 'workflow_change' && params.resultPayload) {
      const workflowState = resolveWorkflowState({}, params.resultPayload)
      if (!workflowState) return
      useWorkflowDiffStore
        .getState()
        .setProposedChanges(workflowState)
        .catch((error) => {
          logger.error('Failed to apply fallback workflow diff from result payload', {
            error: error instanceof Error ? error.message : String(error),
          })
        })
    }
    return
  }

  for (const effect of effects) {
    switch (effect.kind) {
      case 'workflow.diff.proposed': {
        const workflowState = resolveWorkflowState(effect.payload, params.resultPayload)
        if (!workflowState) break
        useWorkflowDiffStore
          .getState()
          .setProposedChanges(workflowState)
          .catch((error) => {
            logger.error('Failed to apply workflow diff effect', {
              error: error instanceof Error ? error.message : String(error),
            })
          })
        break
      }

      case 'workflow.deployment.sync':
        applyDeploymentSyncEffect(effect.payload, params.toolCall)
        break

      case 'workflow.api_key.sync':
        applyApiKeySyncEffect(effect.payload, params.toolCall)
        break

      case 'environment.variables.reload':
        useEnvironmentStore.getState().loadEnvironmentVariables()
        break

      case 'workflow.variables.reload':
        applyWorkflowVariablesReload(effect.payload, params.toolCall)
        break

      default:
        logger.debug('Ignoring unknown tool effect', { kind: effect.kind })
        break
    }
  }
}
