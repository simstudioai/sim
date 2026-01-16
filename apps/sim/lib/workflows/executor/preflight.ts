import { createLogger } from '@sim/logger'
import {
  ensureBlockEnvVarsResolvable,
  ensureEnvVarsDecryptable,
  getPersonalAndWorkspaceEnv,
} from '@/lib/environment/utils'
import { loadDeployedWorkflowState } from '@/lib/workflows/persistence/utils'
import { mergeSubblockState } from '@/stores/workflows/server-utils'

const logger = createLogger('ExecutionPreflight')

export interface EnvVarPreflightOptions {
  workflowId: string
  workspaceId: string
  envUserId: string
  requestId?: string
}

/**
 * Preflight env var checks to avoid scheduling executions that will fail.
 * Always uses deployed workflow state since preflight is only done for async
 * executions which always run on deployed state.
 */
export async function preflightWorkflowEnvVars({
  workflowId,
  workspaceId,
  envUserId,
  requestId,
}: EnvVarPreflightOptions): Promise<void> {
  const workflowData = await loadDeployedWorkflowState(workflowId)

  if (!workflowData) {
    throw new Error('Workflow state not found')
  }

  const mergedStates = mergeSubblockState(workflowData.blocks)
  const { personalEncrypted, workspaceEncrypted } = await getPersonalAndWorkspaceEnv(
    envUserId,
    workspaceId
  )
  const variables = { ...personalEncrypted, ...workspaceEncrypted }

  await ensureBlockEnvVarsResolvable(mergedStates, variables, { requestId })
  await ensureEnvVarsDecryptable(variables, { requestId })

  if (requestId) {
    logger.debug(`[${requestId}] Env var preflight passed`, { workflowId })
  } else {
    logger.debug('Env var preflight passed', { workflowId })
  }
}
