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
import { listProjects } from '@/lib/projects/application'
import { isProjectFileApiEnabled } from '@/lib/projects/rollout.server'

/** Adds current owner hints to admitted authoring turns using the worker's generated contract. */
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
    !(await isProjectFileApiEnabled()) ||
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
      const result = await executeCopilotProjectDiscovery(discoveryContext, listProjects, {
        limit: 1,
      })
      const project = result.projects[0]
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
      if (code !== 'forbidden' && code !== 'not_found') throw error
    }
  }
  return { ...clean, ...hints }
}
