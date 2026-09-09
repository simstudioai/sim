import { db } from '@sim/db'
import { workspaceOperationReceipt } from '@sim/db/schema'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ActiveWorkspaceApplicationContext,
  resolveActiveWorkspaceApplicationContext,
} from '@/lib/workspaces/application/workspace-context'
import { workspaceOperations } from '@/lib/workspaces/operations/operations'
import type { WorkspaceOperationReport } from '@/lib/workspaces/operations/receipts'
import { refreshWorkspaceOperation } from '@/lib/workspaces/operations/refresh'

export const getWorkspaceOperation = defineAuthorizedWorkspaceUseCase<
  typeof workspaceOperations.read,
  { workspaceId: string; operationId: string },
  ActiveWorkspaceApplicationContext,
  WorkspaceOperationReport
>({
  operation: workspaceOperations.read,
  authorizationOptions: {},
  resolveContext: ({ input }: { input: { workspaceId: string; operationId: string } }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  async execute({ input, context }) {
    const report = await refreshWorkspaceOperation(context.workspaceId, input.operationId)
    if (!report) throw new OrchestrationError('not_found', 'Operation not found')
    return report
  },
})

const operationCursorSchema = z
  .object({
    id: z.string().min(1).max(256),
    createdAt: z
      .string()
      .max(64)
      .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/),
    workspaceId: z.string().max(256),
    requestId: z.string().max(128).optional(),
  })
  .strict()
interface ListWorkspaceOperationsInput {
  workspaceId: string
  requestId?: string
  limit: number
  cursor?: string
}

export const listWorkspaceOperations = defineAuthorizedWorkspaceUseCase({
  operation: workspaceOperations.read,
  authorizationOptions: {},
  resolveContext: ({ input }: { input: ListWorkspaceOperationsInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  async execute({ input, context }) {
    let cursor: z.output<typeof operationCursorSchema> | undefined
    if (input.cursor) {
      try {
        cursor = operationCursorSchema.parse(
          JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))
        )
      } catch {
        throw new OrchestrationError('validation', 'Invalid operation cursor')
      }
      if (cursor.workspaceId !== context.workspaceId || cursor.requestId !== input.requestId)
        throw new OrchestrationError(
          'validation',
          'Cursor does not match the requested operation filters'
        )
    }
    const candidates = await db
      .select({
        id: workspaceOperationReceipt.id,
        createdAt: sql<string>`${workspaceOperationReceipt.createdAt}::text`,
        bytes: sql<number>`octet_length(${workspaceOperationReceipt.report}::text)`,
      })
      .from(workspaceOperationReceipt)
      .where(
        and(
          eq(workspaceOperationReceipt.workspaceId, context.workspaceId),
          input.requestId ? eq(workspaceOperationReceipt.requestId, input.requestId) : undefined,
          cursor
            ? sql`(${workspaceOperationReceipt.createdAt}, ${workspaceOperationReceipt.id}) < (${cursor.createdAt}::timestamp, ${cursor.id})`
            : undefined
        )
      )
      .orderBy(desc(workspaceOperationReceipt.createdAt), desc(workspaceOperationReceipt.id))
      .limit(input.limit + 1)
    let bytes = 0
    const selected = []
    for (const row of candidates.slice(0, input.limit)) {
      if (selected.length && bytes + row.bytes > 2 * 1024 * 1024) break
      selected.push(row)
      bytes += row.bytes
    }
    const rows = selected.length
      ? await db
          .select({ report: workspaceOperationReceipt.report })
          .from(workspaceOperationReceipt)
          .where(
            and(
              eq(workspaceOperationReceipt.workspaceId, context.workspaceId),
              inArray(
                workspaceOperationReceipt.id,
                selected.map((row) => row.id)
              )
            )
          )
          .orderBy(desc(workspaceOperationReceipt.createdAt), desc(workspaceOperationReceipt.id))
      : []
    const last = selected.at(-1)
    return {
      operations: rows.map((row) => row.report as WorkspaceOperationReport),
      nextCursor:
        last && candidates.length > selected.length
          ? Buffer.from(
              JSON.stringify({
                id: last.id,
                createdAt: last.createdAt,
                workspaceId: context.workspaceId,
                requestId: input.requestId,
              })
            ).toString('base64url')
          : null,
    }
  },
})
