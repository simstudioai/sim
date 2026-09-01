import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { getBYOKKey } from '@/lib/api-key/byok'
import { isWorkspaceOnEnterprisePlan } from '@/lib/billing/core/subscription'

const logger = createLogger('EnterpriseByok')

/**
 * Resolves the enterprise BYOK key sim-side for a mothership call (contract field
 * `byokApiKey`, S27): the worker builds per-request provider instances from it and
 * retains nothing. Eligibility (enterprise plan) gates resolution server-side, so a
 * client can never assert its own eligibility; key rows are read fresh so revocation is
 * immediate. Failures default to hosted.
 *
 * Every worker call that reaches a model must resolve this — the initial send, the
 * workflow-scoped copilot send, one-shot executes, tool-resume (a dead-run continuation
 * leg re-applies it), and title generation — or that leg silently runs on the hosted key.
 */
export async function resolveEnterpriseByokKey(
  workspaceId: string | undefined
): Promise<string | null> {
  if (!workspaceId) return null
  try {
    if (!(await isWorkspaceOnEnterprisePlan(workspaceId))) return null
    const byok = await getBYOKKey(workspaceId, 'anthropic')
    return byok?.apiKey ?? null
  } catch (error) {
    logger.warn('Failed to resolve BYOK key; defaulting to hosted', {
      workspaceId,
      error: toError(error).message,
    })
    return null
  }
}
