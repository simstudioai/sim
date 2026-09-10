import { db } from '@sim/db'
import { workspace, workspaceForkResourceMap } from '@sim/db/schema'
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ForkCopyableResources,
  listForkCopyableResourcePage,
} from '@/lib/workflows/references/resources'
import { workflowOperationFingerprint } from '@/lib/workspaces/operations/receipts'
import { defineForkUseCase } from '@/ee/workspace-forking/application/authorized-fork-use-case'
import { forkOperations } from '@/ee/workspace-forking/application/operations'
import { isForkingAvailableForWorkspace } from '@/ee/workspace-forking/lib/lineage/authz'
import { getForkParent } from '@/ee/workspace-forking/lib/lineage/lineage'
import { resourceTypeToForkKind } from '@/ee/workspace-forking/lib/mapping/mapping-store'

interface WorkspaceInput {
  workspaceId: string
}
interface PageInput extends WorkspaceInput {
  limit: number
  cursor?: string
  sortBy: string
  sortOrder: string
}
const cursorSchema = z
  .object({
    id: z.string().min(1).max(4096),
    createdAt: z
      .string()
      .max(64)
      .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/)
      .optional(),
    scope: z.string().length(64),
  })
  .strict()

function readCursor(input: PageInput, filters: Record<string, unknown>) {
  const scope = workflowOperationFingerprint({
    workspaceId: input.workspaceId,
    sortBy: input.sortBy,
    sortOrder: input.sortOrder,
    ...filters,
  })
  if (!input.cursor) return { scope, id: undefined, createdAt: undefined }
  try {
    const value = cursorSchema.parse(
      JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))
    )
    if (value.scope !== scope) throw new Error('Cursor scope mismatch')
    return value
  } catch {
    throw new OrchestrationError(
      'validation',
      'Cursor does not match this workspace, collection, or sort'
    )
  }
}

function pageResult<T extends { id: string; cursorCreatedAt?: string }>(
  rows: T[],
  limit: number,
  scope: string
) {
  const items = rows.slice(0, limit)
  const last = items.at(-1)
  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({ id: last.id, createdAt: last.cursorCreatedAt, scope })
          ).toString('base64url')
        : null,
  }
}

export const getWorkspaceForkAvailability = defineForkUseCase({
  operation: forkOperations.discover,
  availability: true,
  execute: async ({
    context,
    principal,
    input: _input,
  }: {
    context: { workspace: { organizationId: string | null } }
    principal: { userId: string }
    input: WorkspaceInput
  }) => ({
    available: await isForkingAvailableForWorkspace(
      context.workspace.organizationId,
      principal.userId
    ),
  }),
})

export const getWorkspaceForkLineage = defineForkUseCase({
  operation: forkOperations.discover,
  execute: async ({
    context,
    input: _input,
  }: {
    context: {
      workspace: { id: string; name: string; organizationId: string | null }
      workspaceId: string
    }
    input: WorkspaceInput
  }) => ({
    current: {
      id: context.workspace.id,
      name: context.workspace.name,
      organizationId: context.workspace.organizationId,
    },
    parent: await getForkParent(context.workspaceId),
  }),
})

export const listWorkspaceForkChildren = defineForkUseCase({
  operation: forkOperations.discover,
  async execute({ input }: { input: PageInput }) {
    const cursor = readCursor(input, { collection: 'children' })
    if (cursor.id && !cursor.createdAt)
      throw new OrchestrationError('validation', 'Invalid children cursor')
    const rows = await db
      .select({
        id: workspace.id,
        name: workspace.name,
        organizationId: workspace.organizationId,
        createdAt: workspace.createdAt,
        cursorCreatedAt: sql<string>`${workspace.createdAt}::text`,
      })
      .from(workspace)
      .where(
        and(
          eq(workspace.forkedFromWorkspaceId, input.workspaceId),
          isNull(workspace.archivedAt),
          cursor.id
            ? sql`(${workspace.createdAt}, ${workspace.id}) < (${cursor.createdAt}::timestamp, ${cursor.id})`
            : undefined
        )
      )
      .orderBy(desc(workspace.createdAt), desc(workspace.id))
      .limit(input.limit + 1)
    const result = pageResult(rows, input.limit, cursor.scope)
    return {
      ...result,
      items: result.items.map(({ cursorCreatedAt: _cursorCreatedAt, ...item }) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
      })),
    }
  },
})

export const listWorkspaceForkResources = defineForkUseCase({
  operation: forkOperations.discover,
  async execute({
    input,
  }: {
    input: PageInput & { kind: keyof Omit<ForkCopyableResources, 'deployedWorkflowCount'> }
  }) {
    const cursor = readCursor(input, { collection: 'copyable_resources', kind: input.kind })
    const rows = await listForkCopyableResourcePage(db, input.workspaceId, input.kind, {
      after: cursor.id,
      limit: input.limit,
    })
    return pageResult(rows, input.limit, cursor.scope)
  },
})

export const getWorkspaceForkMappings = defineForkUseCase({
  operation: forkOperations.mappingsRead,
  bothSides: true,
  edge: true,
  async execute({
    input,
    context,
  }: {
    input: PageInput & { otherWorkspaceId: string; direction: 'push' | 'pull' }
    context: { edge?: { childWorkspaceId: string; parentWorkspaceId: string } }
  }) {
    if (!context.edge) throw new Error('Mapping reads require an authorized edge')
    const cursor = readCursor(input, {
      collection: 'mappings',
      otherWorkspaceId: input.otherWorkspaceId,
      direction: input.direction,
    })
    const rows = await db
      .select({
        id: workspaceForkResourceMap.id,
        resourceType: workspaceForkResourceMap.resourceType,
        parentResourceId: workspaceForkResourceMap.parentResourceId,
        childResourceId: workspaceForkResourceMap.childResourceId,
      })
      .from(workspaceForkResourceMap)
      .where(
        and(
          eq(workspaceForkResourceMap.childWorkspaceId, context.edge.childWorkspaceId),
          sql`${workspaceForkResourceMap.resourceType} NOT IN ('workflow', 'workflow_mcp_server', 'knowledge_document')`,
          cursor.id ? gt(workspaceForkResourceMap.id, cursor.id) : undefined
        )
      )
      .orderBy(asc(workspaceForkResourceMap.id))
      .limit(input.limit + 1)
    const sourceId = input.direction === 'push' ? input.workspaceId : input.otherWorkspaceId
    const sourceIsParent = sourceId === context.edge.parentWorkspaceId
    const result = pageResult(rows, input.limit, cursor.scope)
    return {
      ...result,
      items: result.items.flatMap((row) => {
        if (!resourceTypeToForkKind(row.resourceType) || row.resourceType === 'knowledge_document')
          return []
        if (row.resourceType === 'workflow' || row.resourceType === 'workflow_mcp_server') return []
        const sourceId = sourceIsParent ? row.parentResourceId : row.childResourceId
        return sourceId
          ? [
              {
                id: row.id,
                resourceType: row.resourceType,
                sourceId,
                targetId: sourceIsParent ? row.childResourceId : row.parentResourceId,
              },
            ]
          : []
      }),
    }
  },
})
