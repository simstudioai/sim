import { db } from '@sim/db'
import { workflow, workflowBlocks } from '@sim/db/schema'
import type { BlockCatalog } from '@sim/workflow-code'
import { and, eq, isNull } from 'drizzle-orm'
import { catalogDelegationPolicy } from '@/lib/catalog/application/authorization'
import {
  loadCatalogWorkspaceContext,
  resolveCatalogGate,
  withCatalogBlockScope,
} from '@/lib/catalog/application/context'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { buildSourceCatalog } from '@/lib/workflows/code/catalog/workspace'
import { requireWorkflowCodeEnabled } from '@/lib/workflows/code/feature-flag'

interface ReadBlockCatalogInput {
  workspaceId: string
  /** Adds this workflow's stored block types (the per-workflow source catalog). */
  workflowId?: string
}

/**
 * The distinct block types placed in an active workflow of this workspace. A workflow in another
 * workspace, or archived, answers as absent so the read cannot probe workflow ids.
 */
async function loadStoredBlockTypes(workspaceId: string, workflowId: string): Promise<string[]> {
  const [owned] = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(
      and(
        eq(workflow.id, workflowId),
        eq(workflow.workspaceId, workspaceId),
        isNull(workflow.archivedAt)
      )
    )
    .limit(1)
  if (!owned) throw new OrchestrationError('not_found', 'Workflow not found')
  const rows = await db
    .selectDistinct({ type: workflowBlocks.type })
    .from(workflowBlocks)
    .where(eq(workflowBlocks.workflowId, workflowId))
  return rows.map((row) => row.type)
}

/**
 * The block catalog the workflow compiler, printer and SDK type generator read: the blocks this
 * caller may place in the workspace (the same allowlist, preview reveals and custom blocks as the
 * block list), or with `workflowId` the source catalog for that workflow. Not audited: reading a
 * catalog is not a semantic event, matching the other catalog reads.
 */
export const readSourceCatalog = defineAuthorizedWorkspaceUseCase({
  operation: workflowOperations.readSourceCatalog,
  resolveContext: ({ input }: { input: ReadBlockCatalogInput }) =>
    loadCatalogWorkspaceContext(input.workspaceId),
  authorizationOptions: { delegation: catalogDelegationPolicy },
  execute: async ({ principal, input, context }): Promise<BlockCatalog> => {
    await requireWorkflowCodeEnabled()
    const [gate, storedTypes] = await Promise.all([
      resolveCatalogGate(principal, context, { customBlockInputs: true }),
      input.workflowId ? loadStoredBlockTypes(context.workspaceId, input.workflowId) : undefined,
    ])
    return withCatalogBlockScope(gate, async () => {
      const { catalog } = buildSourceCatalog({
        gate,
        organizationId: context.workspaceOrganizationId,
        ...(storedTypes ? { storedTypes } : {}),
      })
      return catalog
    })
  },
})
