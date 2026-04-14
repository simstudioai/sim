import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { SetEnvironmentVariables } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  ensureWorkflowAccess,
  ensureWorkspaceAccess,
  getDefaultWorkspaceId,
} from '@/lib/copilot/tools/handlers/access'
import type { BaseServerTool, ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import { upsertPersonalEnvVars, upsertWorkspaceEnvVars } from '@/lib/environment/utils'

type EnvironmentVariableInputValue = string | number | boolean | null | undefined

interface EnvironmentVariableInput {
  name: string
  value: EnvironmentVariableInputValue
}

interface SetEnvironmentVariablesParams {
  variables: Record<string, EnvironmentVariableInputValue> | EnvironmentVariableInput[]
  scope?: 'personal' | 'workspace'
  workflowId?: string
  workspaceId?: string
}

interface SetEnvironmentVariablesResult {
  message: string
  scope: 'personal' | 'workspace'
  workspaceId?: string
  variableCount: number
  variableNames: string[]
  addedVariables: string[]
  updatedVariables: string[]
  workspaceUpdatedVariables: string[]
}

const EnvVarSchema = z.object({ variables: z.record(z.string()) })

function normalizeVariables(
  input: Record<string, EnvironmentVariableInputValue> | EnvironmentVariableInput[]
): Record<string, string> {
  if (Array.isArray(input)) {
    return input.reduce(
      (acc, item) => {
        if (item && typeof item.name === 'string') {
          acc[item.name] = String(item.value ?? '')
        }
        return acc
      },
      {} as Record<string, string>
    )
  }
  return Object.fromEntries(
    Object.entries(input || {}).map(([k, v]) => [k, String(v ?? '')])
  ) as Record<string, string>
}

async function resolveWorkspaceId(
  params: SetEnvironmentVariablesParams,
  context: ServerToolContext | undefined,
  userId: string
): Promise<string> {
  if (params.workflowId) {
    const { workflow } = await ensureWorkflowAccess(params.workflowId, userId, 'write')
    if (!workflow.workspaceId) {
      throw new Error(`Workflow ${params.workflowId} is not associated with a workspace`)
    }
    return workflow.workspaceId
  }

  const workspaceId = params.workspaceId ?? context?.workspaceId
  if (workspaceId) {
    await ensureWorkspaceAccess(workspaceId, userId, 'write')
    return workspaceId
  }

  return getDefaultWorkspaceId(userId)
}

export const setEnvironmentVariablesServerTool: BaseServerTool<
  SetEnvironmentVariablesParams,
  SetEnvironmentVariablesResult
> = {
  name: SetEnvironmentVariables.id,
  async execute(
    params: SetEnvironmentVariablesParams,
    context?: ServerToolContext
  ): Promise<SetEnvironmentVariablesResult> {
    const logger = createLogger('SetEnvironmentVariablesServerTool')

    if (!context?.userId) {
      logger.error(
        'Unauthorized attempt to set environment variables - no authenticated user context'
      )
      throw new Error('Authentication required')
    }

    const authenticatedUserId = context.userId
    const { variables } = params || ({} as SetEnvironmentVariablesParams)
    const scope = params.scope === 'personal' ? 'personal' : 'workspace'

    const normalized = normalizeVariables(variables || {})
    const { variables: validatedVariables } = EnvVarSchema.parse({ variables: normalized })
    const variableNames = Object.keys(validatedVariables)
    const added: string[] = []
    const updated: string[] = []
    let workspaceUpdated: string[] = []

    let resolvedWorkspaceId: string | undefined
    if (scope === 'workspace') {
      resolvedWorkspaceId = await resolveWorkspaceId(params, context, authenticatedUserId)
      workspaceUpdated = await upsertWorkspaceEnvVars(
        resolvedWorkspaceId,
        validatedVariables,
        authenticatedUserId
      )
    } else {
      const result = await upsertPersonalEnvVars(authenticatedUserId, validatedVariables)
      added.push(...result.added)
      updated.push(...result.updated)
    }

    const totalProcessed = added.length + updated.length + workspaceUpdated.length

    logger.info('Saved environment variables', {
      userId: authenticatedUserId,
      scope,
      addedCount: added.length,
      updatedCount: updated.length,
      workspaceUpdatedCount: workspaceUpdated.length,
      workspaceId: resolvedWorkspaceId,
    })

    const parts: string[] = []
    if (added.length > 0) parts.push(`${added.length} personal secret(s) added`)
    if (updated.length > 0) parts.push(`${updated.length} personal secret(s) updated`)
    if (workspaceUpdated.length > 0)
      parts.push(`${workspaceUpdated.length} workspace secret(s) updated`)

    return {
      message: `Successfully processed ${totalProcessed} secret(s): ${parts.join(', ')}`,
      scope,
      workspaceId: resolvedWorkspaceId,
      variableCount: variableNames.length,
      variableNames,
      addedVariables: added,
      updatedVariables: updated,
      workspaceUpdatedVariables: workspaceUpdated,
    }
  },
}
