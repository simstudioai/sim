import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { omit, toArray } from '@sim/utils/object'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { executeCopilotProjectDiscovery } from '@/lib/mothership/application/execute-project-use-case'
import {
  type CopilotExecutionContext,
  hasCopilotResourceAdmission,
} from '@/lib/mothership/auth/application-delegation'
import { getCopilotFileOwnerAdapter } from '@/lib/mothership/file-owners'
import type { FileOwnerContext } from '@/lib/mothership/generated/file-owner'
import { WORKSPACE_FILE_COPY_CAPABILITY } from '@/lib/mothership/generated/protocol'
import { supportsFileOwnerProtocol } from '@/lib/mothership/request/lifecycle/file-owner-protocol'
import { getCurrentWorkspaceProject } from '@/lib/projects/application'
import { isProjectsEnabled } from '@/lib/projects/rollout.server'

const logger = createLogger('CopilotFileOwnerContext')

/**
 * Adds what admitted authoring turns may do with files, using the worker's generated contract.
 * Every such turn declares `workspace-file-copy`: copies between workspaces need the turn's
 * admission but not Projects, and a worker that predates the token ignores it. With Projects on,
 * it also gets current owner hints. Hints are best-effort: a failed Project lookup sends the turn
 * with no Project rather than failing it. Support is probed on the selected worker URL, which may
 * front several worker releases, and a worker that predates the hint keys rejects them; rolling
 * the worker back therefore requires turning the `projects` flag off first.
 */
export async function withFileOwnerContext(
  payload: Record<string, unknown>,
  context: CopilotExecutionContext,
  baseURL: string,
  route: string
): Promise<Record<string, unknown>> {
  const clean = omit(payload, ['project', 'fileOwnerCapabilities', 'fileOwnerProtocolVersion'])
  if (!['/api/copilot', '/api/mothership'].includes(route)) return clean
  const admitted = context.requestMode !== 'assistant' && hasCopilotResourceAdmission(context)
  const declared = toArray(clean.clientCapabilities).filter(
    (capability) => capability !== WORKSPACE_FILE_COPY_CAPABILITY
  )
  const turn = admitted
    ? { ...clean, clientCapabilities: [...declared, WORKSPACE_FILE_COPY_CAPABILITY] }
    : clean.clientCapabilities === undefined
      ? clean
      : { ...clean, clientCapabilities: declared }
  if (!admitted || !(await isProjectsEnabled()) || !(await supportsFileOwnerProtocol(baseURL)))
    return turn

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
  return { ...turn, ...hints }
}
