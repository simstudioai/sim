import { db } from '@sim/db'
import { workflow, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  assertFolderInWorkspace,
  assertFolderMutable,
  FolderLockedError,
  FolderNotFoundError,
} from '@sim/platform-authz/workflow'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { truncate } from '@sim/utils/string'
import { and, eq, isNull } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  V1_IMPORT_DESCRIPTION_MAX_LENGTH,
  V1_IMPORT_NAME_MAX_LENGTH,
  type V1ImportWorkflowData,
  v1ImportWorkflowContract,
} from '@/lib/api/contracts/v1/workflows'
import { workflowStateSchema } from '@/lib/api/contracts/workflows'
import { parseRequest, serializeZodIssues } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { parseWorkflowJson } from '@/lib/workflows/operations/import-export'
import { performCreateWorkflow } from '@/lib/workflows/orchestration'
import { extractAndPersistCustomTools } from '@/lib/workflows/persistence/custom-tools-persistence'
import { prepareWorkflowStateForPersistence } from '@/lib/workflows/persistence/prepare-state'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import { normalizeImportedVariables } from '@/lib/workflows/variables/parse'
import { createApiResponse, getUserLimits } from '@/app/api/v1/logs/meta'
import {
  checkRateLimit,
  createRateLimitResponse,
  v1ValidationErrorResponse,
  validateWorkspaceAccess,
} from '@/app/api/v1/middleware'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

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

const TRUNCATION_SUFFIX = '...'

/**
 * Caps a payload-derived string at `maxLength` *including* the ellipsis.
 * `truncate` appends its suffix after slicing, so passing the limit straight
 * through would yield `maxLength + 3` characters and overshoot the very bound
 * this is enforcing.
 */
function capLength(value: string, maxLength: number): string {
  return truncate(value, maxLength - TRUNCATION_SUFFIX.length, TRUNCATION_SUFFIX)
}

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
  return typeof current === 'string' && current.trim() ? current.trim() : undefined
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
 *
 * Candidate order deliberately matches `extractWorkflowName` — the resolver the
 * in-app importer has always used — so the same payload yields the same name on
 * both surfaces. The in-app version additionally falls back to the uploaded
 * filename, which has no analogue here; that is the only intended difference.
 *
 * Payload-derived values are capped at the same bounds the contract applies to
 * the explicit overrides, otherwise the declared `maxLength` would not be the
 * effective one — a caller could store an unbounded name simply by embedding it
 * in the payload instead of passing it as a field.
 */
function resolveImportedMetadata(
  rawPayload: unknown,
  overrideName?: string,
  overrideDescription?: string
): { name: string; description: string } {
  const payload = unwrapResponseEnvelope(rawPayload)

  const name =
    overrideName ||
    capLength(
      readString(payload, 'state.metadata.name') ||
        readString(payload, 'workflow.name') ||
        readString(payload, 'metadata.name') ||
        DEFAULT_IMPORTED_WORKFLOW_NAME,
      V1_IMPORT_NAME_MAX_LENGTH
    )

  const description =
    overrideDescription ??
    capLength(
      readString(payload, 'state.metadata.description') ??
        readString(payload, 'workflow.description') ??
        readString(payload, 'metadata.description') ??
        '',
      V1_IMPORT_DESCRIPTION_MAX_LENGTH
    )

  return { name, description }
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
          v1ValidationErrorResponse(error, 'Invalid request body'),
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

    /**
     * Ownership before lock state: `assertFolderMutable` walks the folder's
     * ancestor chain without filtering on workspace, so checking it first would
     * let a caller distinguish a locked folder in someone else's workspace
     * (423) from a nonexistent one (404).
     */
    if (folderId) {
      await assertFolderInWorkspace(folderId, workspaceId)
    }
    await assertFolderMutable(folderId ?? null)

    const rawWorkflow = parsed.data.body.workflow
    const workflowContent =
      typeof rawWorkflow === 'string' ? rawWorkflow : JSON.stringify(rawWorkflow)

    const { data: parsedState, errors } = parseWorkflowJson(workflowContent)
    if (!parsedState || errors.length > 0) {
      return NextResponse.json({ error: `Invalid workflow: ${errors.join(', ')}` }, { status: 400 })
    }

    /**
     * Variables are normalized before validation, not after: older exports
     * carry them as an array, which is a shape `workflowStateSchema` rightly
     * rejects but the importer has always accepted. Normalizing first keeps
     * that tolerance while still validating what actually gets persisted.
     */
    const variables = normalizeImportedVariables(parsedState.variables)

    /**
     * `parseWorkflowJson` only checks that blocks/edges are structurally
     * present. The normalized tables are read back through
     * {@link workflowStateSchema}, and the client parses that response
     * strictly — so a block field with the wrong type (`data.extent: 'child'`,
     * `data.count: '5'`) would persist happily here and then throw on every
     * subsequent load, leaving a workflow nothing can open. Gate on the same
     * schema the canonical `PUT /api/workflows/[id]/state` path enforces.
     */
    const stateValidation = workflowStateSchema.safeParse({ ...parsedState, variables })
    if (!stateValidation.success) {
      const issue = stateValidation.error.issues[0]
      const path = issue?.path.join('.')
      return NextResponse.json(
        {
          error: `Invalid workflow state${path ? ` at ${path}` : ''}: ${issue?.message ?? 'validation failed'}`,
          details: serializeZodIssues(stateValidation.error),
        },
        { status: 400 }
      )
    }

    /**
     * Same normalization the editor's `PUT /api/workflows/[id]/state` runs, via
     * the one shared implementation — the two import surfaces must land
     * byte-identical data for the same payload.
     */
    const { state: preparedState, warnings } = prepareWorkflowStateForPersistence(parsedState)
    if (warnings.length > 0) {
      logger.warn(`[${requestId}] Normalized imported workflow with warnings`, { warnings })
    }

    const workflowState: WorkflowState = { ...parsedState, ...preparedState }

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

    /**
     * The graph and the variables are written in one transaction so an import
     * can never half-land, and any failure deletes the shell row created above
     * — a caller that receives an error must not be left with a partially
     * imported workflow in their workspace.
     */
    try {
      await db.transaction(async (tx) => {
        const saveResult = await saveWorkflowToNormalizedTables(workflowId, workflowState, tx)
        if (!saveResult.success) {
          throw new Error(saveResult.error || 'Failed to save workflow state')
        }

        if (Object.keys(variables).length > 0) {
          await tx
            .update(workflow)
            .set({ variables, updatedAt: new Date() })
            .where(eq(workflow.id, workflowId))
        }
      })
    } catch (error) {
      logger.error(`[${requestId}] Failed to persist imported workflow, rolling back`, {
        workflowId,
        error: getErrorMessage(error, 'Unknown error'),
      })
      /**
       * The rollback runs under the same conditions that just failed the write,
       * so it can fail too. Losing it must not turn into an unlogged orphan:
       * the caller still gets a 500, but the id is recorded loudly enough to
       * clean up.
       */
      try {
        await db.delete(workflow).where(eq(workflow.id, workflowId))
      } catch (rollbackError) {
        logger.error(
          `[${requestId}] Rollback failed, workflow ${workflowId} is orphaned in workspace ${workspaceId}`,
          { workflowId, workspaceId, error: getErrorMessage(rollbackError, 'Unknown error') }
        )
      }
      return NextResponse.json({ error: 'Failed to save workflow state' }, { status: 500 })
    }

    /**
     * Matches the canonical state-write path: agent blocks may carry inline
     * custom-tool definitions that must exist as workspace rows to be
     * resolvable at execution. Failures are logged, not fatal — the workflow
     * itself imported successfully.
     */
    try {
      const { saved, errors: toolErrors } = await extractAndPersistCustomTools(
        workflowState,
        workspaceId,
        userId
      )
      if (saved > 0 || toolErrors.length > 0) {
        logger.info(`[${requestId}] Persisted ${saved} custom tool(s) from import`, {
          workflowId,
          errors: toolErrors,
        })
      }
    } catch (error) {
      logger.error(`[${requestId}] Failed to persist custom tools from import`, {
        workflowId,
        error: getErrorMessage(error, 'Unknown error'),
      })
    }

    logger.info(`[${requestId}] Imported workflow ${workflowId} into workspace ${workspaceId}`, {
      name: created.workflow.name,
      blocksCount: Object.keys(workflowState.blocks).length,
    })

    const data: V1ImportWorkflowData = {
      id: workflowId,
      name: created.workflow.name,
      description: created.workflow.description ?? null,
      workspaceId,
      folderId: created.workflow.folderId ?? null,
      createdAt: created.workflow.createdAt.toISOString(),
      updatedAt: created.workflow.updatedAt.toISOString(),
    }

    const limits = await getUserLimits(userId)
    const apiResponse = createApiResponse({ data }, limits, rateLimit)

    return NextResponse.json(apiResponse.body, { status: 201, headers: apiResponse.headers })
  } catch (error: unknown) {
    if (error instanceof FolderLockedError || error instanceof FolderNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    const message = getErrorMessage(error, 'Unknown error')
    logger.error(`[${requestId}] Workflow import error`, { error: message })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
