import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { omit } from '@sim/utils/object'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { executeCopilotProjectDiscovery } from '@/lib/mothership/application/execute-project-use-case'
import {
  type CopilotExecutionContext,
  hasCopilotResourceAdmission,
} from '@/lib/mothership/auth/application-delegation'
import { getCopilotFileOwnerAdapter } from '@/lib/mothership/file-owners'
import type { FileOwnerContext } from '@/lib/mothership/generated/file-owner'
import { supportsFileOwnerProtocol } from '@/lib/mothership/request/lifecycle/file-owner-protocol'
import { getCurrentWorkspaceProject } from '@/lib/projects/application'
import { isProjectsEnabled } from '@/lib/projects/rollout.server'

const logger = createLogger('CopilotFileOwnerContext')

/**
 * Adds current owner hints to admitted authoring turns using the worker's generated contract.
 * Hints are best-effort: a failed Project lookup sends the turn with no Project rather than failing
 * it. Support is probed on the selected worker URL, which may front several worker releases, and a
 * worker that predates the hint keys rejects them; rolling the worker back therefore requires
 * turning the `projects` flag off first.
 */
export async function withFileOwnerContext(
  payload: Record<string, unknown>,
  context: CopilotExecutionContext,
  baseURL: string,
  route: string
): Promise<Record<string, unknown>> {
  const clean = omit(payload, ['project', 'fileOwnerCapabilities', 'fileOwnerProtocolVersion'])
  if (
    !['/api/copilot', '/api/mothership'].includes(route) ||
    context.requestMode === 'assistant' ||
    !(await isProjectsEnabled()) ||
    !hasCopilotResourceAdmission(context) ||
    !(await supportsFileOwnerProtocol(baseURL))
  )
    return clean

  const hints: FileOwnerContext = {
    fileOwnerProtocolVersion: 1,
    project: null,
    fileOwnerCapabilities: [],
  }
  if (context.workspaceId) {
    const discoveryContext = { ...context, toolCallId: `file-context:${generateId()}` }
    try {
      const result = await executeCopilotProjectDiscovery(
        discoveryContext,
        getCurrentWorkspaceProject,
        {}
      )
      const project = result.project
      if (project) {
        const owner = { entityType: 'project' as const, entityId: project.id }
        const capability = await getCopilotFileOwnerAdapter(owner).capabilities?.(
          discoveryContext,
          owner
        )
        hints.project = { id: project.id, name: project.name }
        hints.fileOwnerCapabilities = capability ? [capability] : []
      }
    } catch (error) {
      const code = asOrchestrationError(error)?.code
      if (code !== 'forbidden' && code !== 'not_found')
        logger.warn('Sending turn without Project file owner hints', {
          error: getErrorMessage(error),
        })
    }
  }
  return { ...clean, ...hints }
}
