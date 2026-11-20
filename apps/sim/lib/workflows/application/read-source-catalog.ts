import { db } from '@sim/db'
import { workflow, workflowBlocks } from '@sim/db/schema'
import type { BlockCatalog } from '@sim/workflow-code'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { catalogDelegationPolicy } from '@/lib/catalog/application/authorization'
import {
  loadCatalogWorkspaceContext,
  resolveCatalogGate,
  withCatalogBlockScope,
} from '@/lib/catalog/application/context'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { workflowOperations } from '@/lib/workflows/application/operations'
import {
  buildSourceCatalog,
  storedCatalogTypes,
  toolInputIds,
} from '@/lib/workflows/code/catalog/workspace'

interface ReadBlockCatalogInput {
  workspaceId: string
  /** Adds this workflow's stored block types (the per-workflow source catalog). */
  workflowId?: string
}

/**
 * The types an active workflow of this workspace stores ({@link storedCatalogTypes}): its distinct
 * block types, in one query of the workflow row left-joined to its blocks (a blockless workflow
 * answers one null type), then the tools attached to the blocks whose type has a `tool-input`
 * field, reading only those blocks' fields. A workflow in another workspace, or archived, answers
 * as absent so the read cannot probe workflow ids.
 */
async function loadStoredTypes(workspaceId: string, workflowId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ type: workflowBlocks.type })
    .from(workflow)
    .leftJoin(workflowBlocks, eq(workflowBlocks.workflowId, workflow.id))
    .where(
      and(
        eq(workflow.id, workflowId),
        eq(workflow.workspaceId, workspaceId),
        isNull(workflow.archivedAt)
      )
    )
  if (rows.length === 0) throw new OrchestrationError('not_found', 'Workflow not found')
  const blockTypes = rows.flatMap((row) => (row.type === null ? [] : [row.type]))
  const toolHosts = blockTypes.filter((type) => toolInputIds(type).length > 0)
  if (toolHosts.length === 0) return blockTypes
  const hosts = await db
    .select({ type: workflowBlocks.type, subBlocks: workflowBlocks.subBlocks })
    .from(workflowBlocks)
    .where(and(eq(workflowBlocks.workflowId, workflowId), inArray(workflowBlocks.type, toolHosts)))
  return [...new Set([...blockTypes, ...storedCatalogTypes(hosts)])]
}

/**
 * The block catalog the workflow compiler, printer and SDK type generator read: the blocks this
 * caller may place in the workspace (the same allowlist, preview reveals and custom blocks as the
 * block list), or with `workflowId` the source catalog for that workflow, its attached tool types
 * included. Not audited: reading a catalog is not a semantic event, matching the other catalog
 * reads.
 */
export const readSourceCatalog = defineAuthorizedWorkspaceUseCase({
  operation: workflowOperations.readSourceCatalog,
  resolveContext: ({ input }: { input: ReadBlockCatalogInput }) =>
    loadCatalogWorkspaceContext(input.workspaceId),
  authorizationOptions: { delegation: catalogDelegationPolicy },
  execute: async ({ principal, input, context }): Promise<BlockCatalog> => {
    const [gate, storedTypes] = await Promise.all([
      resolveCatalogGate(principal, context, { customBlockInputs: true }),
      input.workflowId ? loadStoredTypes(context.workspaceId, input.workflowId) : undefined,
    ])
    return withCatalogBlockScope(gate, async () =>
      buildSourceCatalog({
        gate,
        organizationId: context.workspaceOrganizationId,
        ...(storedTypes ? { storedTypes } : {}),
      })
    )
  },
})
