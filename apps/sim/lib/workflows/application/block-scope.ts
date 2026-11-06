import type { ActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { listCustomBlocksWithInputsForWorkspace } from '@/lib/workflows/custom-blocks/operations'
import { withCustomBlockOverlay } from '@/blocks/custom/server-overlay'

/**
 * Authoring needs the deployed input schemas, just like the block catalog.
 * Establish this scope after workflow authorization and keep it through graph
 * normalization, validation, lint and persistence preparation. Even a personal
 * workspace gets an empty scope so it cannot inherit another org's registry.
 */
export async function withWorkflowBlockScope<T>(
  context: Pick<ActiveWorkflowApplicationContext, 'workspaceId' | 'workspaceOrganizationId'>,
  run: () => Promise<T>
): Promise<T> {
  const rows = context.workspaceOrganizationId
    ? await listCustomBlocksWithInputsForWorkspace(context.workspaceId)
    : []
  return withCustomBlockOverlay(rows, run)
}
