import { db } from '@sim/db'
import { workflow, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { assertFolderMutable, FolderLockedError } from '@sim/platform-authz/workflow'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { Variable } from '@sim/workflow-types/workflow'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type V1ImportWorkflowData,
  v1ImportWorkflowContract,
} from '@/lib/api/contracts/v1/workflows'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { parseWorkflowJson } from '@/lib/workflows/operations/import-export'
import { performCreateWorkflow } from '@/lib/workflows/orchestration'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import { createApiResponse, getUserLimits } from '@/app/api/v1/logs/meta'
import {
  checkRateLimit,
  createRateLimitResponse,
  validateWorkspaceAccess,
} from '@/app/api/v1/middleware'

const logger = createLogger('V1WorkflowImportAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Workflow JSON is a bounded document — a few hundred blocks at the outside.
 * Capping well below the platform-wide `DEFAULT_MAX_JSON_BODY_BYTES` (50 MB)
 * keeps a hostile caller from buffering a large body before validation runs.
 */
const MAX_IMPORT_BODY_BYTES = 10 * 1024 * 1024

const DEFAULT_IMPORTED_WORKFLOW_NAME = 'Imported Workflow'

/**
 * Reads a dot-delimited path off a parsed payload and returns it only when it
 * is a non-empty string, so blank metadata falls through to the next candidate.
 */
function readString(source: unknown, path: string): string | undefined {
  let current: unknown = source
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return typeof current === 'string' && current.trim() ? current : undefined
}

/**
 * Unwraps the `{ data: ... }` response envelope the export endpoint returns, so
 * a caller can pipe an export response body straight into import.
 * `parseWorkflowJson` already tolerates this shape when reading the graph;
 * mirroring it here keeps metadata resolution from silently falling back to the
 * default name for the same payload.
 */
function unwrapResponseEnvelope(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload
  const inner = (payload as Record<string, unknown>).data
  if (!inner || typeof inner !== 'object') return payload
  const candidate = inner as Record<string, unknown>
  return candidate.state || candidate.version || candidate.workflow ? candidate : payload
}

/**
 * Resolves the imported workflow's name and description, preferring explicit
 * request overrides and then the payload's own metadata. Accepts every shape
 * the importer takes: the export envelope (`workflow.*`, `state.metadata.*`)
 * and a bare state (`metadata.*`).
 */
function resolveImportedMetadata(
  rawPayload: unknown,
  overrideName?: string,
  overrideDescription?: string
): { name: string; description: string } {
  const payload = unwrapResponseEnvelope(rawPayload)

  const name =
    overrideName ||
    readString(payload, 'workflow.name') ||
    readString(payload, 'state.metadata.name') ||
    readString(payload, 'metadata.name') ||
    DEFAULT_IMPORTED_WORKFLOW_NAME

  const description =
    overrideDescription ??
    readString(payload, 'workflow.description') ??
    readString(payload, 'state.metadata.description') ??
    readString(payload, 'metadata.description') ??
    ''

  return { name, description }
}

/**
 * Normalizes parsed variables into the persisted `Record<string, Variable>`
 * shape, keyed by variable id. Accepts both the record form and the legacy
 * array form that older exports carry.
 */
function toVariablesRecord(variables: unknown): Record<string, Variable> {
  const record: Record<string, Variable> = {}
  if (!variables || typeof variables !== 'object') return record

  const entries: Array<[string | undefined, unknown]> = Array.isArray(variables)
    ? variables.map((value) => [undefined, value])
    : Object.entries(variables)

  for (const [key, value] of entries) {
    if (!value || typeof value !== 'object') continue
    const raw = value as Partial<Variable>
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id : (key ?? generateId())

    record[id] = {
      id,
      name: typeof raw.name === 'string' ? raw.name : id,
      type: raw.type ?? 'string',
      value: raw.value,
    }
  }

  return record
}

/**
 * POST /api/v1/workflows/import
 *
 * Creates a new workflow in the target workspace from an export payload
 * produced by `GET /api/v1/workflows/{id}/export`. Block, edge, loop and
 * parallel ids are regenerated on import, so the same payload can be imported
 * repeatedly and alongside its source workflow without collisions.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const rateLimit = await checkRateLimit(request, 'workflow-import')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const parsed = await parseRequest(
      v1ImportWorkflowContract,
      request,
      {},
      {
        maxBodyBytes: MAX_IMPORT_BODY_BYTES,
        validationErrorResponse: (error) =>
          NextResponse.json(
            {
              error: getValidationErrorMessage(error, 'Invalid request body'),
              details: error.issues,
            },
            { status: 400 }
          ),
      }
    )
    if (!parsed.success) return parsed.response

    const {
      workspaceId,
      folderId,
      name: overrideName,
      description: overrideDescription,
    } = parsed.data.body

    logger.info(`[${requestId}] Importing workflow into workspace ${workspaceId}`, {
      userId,
      folderId,
    })

    const accessError = await validateWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (accessError) return accessError

    const [workspaceData] = await db
      .select({ id: workspace.id })
      .from(workspace)
      .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
      .limit(1)

    if (!workspaceData) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    await assertFolderMutable(folderId ?? null)

    const rawWorkflow = parsed.data.body.workflow
    const workflowContent =
      typeof rawWorkflow === 'string' ? rawWorkflow : JSON.stringify(rawWorkflow)

    const { data: workflowState, errors } = parseWorkflowJson(workflowContent)
    if (!workflowState || errors.length > 0) {
      return NextResponse.json({ error: `Invalid workflow: ${errors.join(', ')}` }, { status: 400 })
    }

    let parsedPayload: unknown = rawWorkflow
    if (typeof rawWorkflow === 'string') {
      try {
        parsedPayload = JSON.parse(rawWorkflow)
      } catch {
        parsedPayload = undefined
      }
    }

    const { name, description } = resolveImportedMetadata(
      parsedPayload,
      overrideName,
      overrideDescription
    )

    const created = await performCreateWorkflow({
      name,
      description,
      workspaceId,
      folderId,
      deduplicate: true,
      userId,
      requestId,
    })

    if (!created.success || !created.workflow) {
      const status =
        created.errorCode === 'conflict' ? 409 : created.errorCode === 'validation' ? 400 : 500
      return NextResponse.json({ error: created.error }, { status })
    }

    const workflowId = created.workflow.id

    const saveResult = await saveWorkflowToNormalizedTables(workflowId, workflowState)
    if (!saveResult.success) {
      await db.delete(workflow).where(eq(workflow.id, workflowId))
      logger.error(`[${requestId}] Failed to persist imported workflow state`, {
        workflowId,
        error: saveResult.error,
      })
      return NextResponse.json({ error: 'Failed to save workflow state' }, { status: 500 })
    }

    const variables = toVariablesRecord(workflowState.variables)
    if (Object.keys(variables).length > 0) {
      await db
        .update(workflow)
        .set({ variables, updatedAt: new Date() })
        .where(eq(workflow.id, workflowId))
    }

    logger.info(`[${requestId}] Imported workflow ${workflowId} into workspace ${workspaceId}`, {
      name: created.workflow.name,
      blocksCount: Object.keys(workflowState.blocks).length,
    })

    const data: V1ImportWorkflowData = {
      id: workflowId,
      name: created.workflow.name,
      description: created.workflow.description || null,
      workspaceId,
      folderId: created.workflow.folderId ?? null,
      createdAt: created.workflow.createdAt.toISOString(),
      updatedAt: created.workflow.updatedAt.toISOString(),
    }

    const limits = await getUserLimits(userId)
    const apiResponse = createApiResponse({ data }, limits, rateLimit)

    return NextResponse.json(apiResponse.body, { status: 201, headers: apiResponse.headers })
  } catch (error: unknown) {
    if (error instanceof FolderLockedError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const message = getErrorMessage(error, 'Unknown error')
    logger.error(`[${requestId}] Workflow import error`, { error: message })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
