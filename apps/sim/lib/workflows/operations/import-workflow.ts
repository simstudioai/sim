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
import { truncate } from '@sim/utils/string'
import { and, eq, isNull } from 'drizzle-orm'
import {
  V1_IMPORT_DESCRIPTION_MAX_LENGTH,
  V1_IMPORT_NAME_MAX_LENGTH,
} from '@/lib/api/contracts/v1/workflows'
import { workflowStateSchema } from '@/lib/api/contracts/workflows'
import { serializeZodIssues } from '@/lib/api/server'
import { parseWorkflowJson } from '@/lib/workflows/operations/import-export'
import { performCreateWorkflow } from '@/lib/workflows/orchestration'
import { extractAndPersistCustomTools } from '@/lib/workflows/persistence/custom-tools-persistence'
import { prepareWorkflowStateForPersistence } from '@/lib/workflows/persistence/prepare-state'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'
import { normalizeImportedVariables } from '@/lib/workflows/variables/parse'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowImportOperation')

/**
 * Server-only import orchestration shared by the v1 and v2 import routes: both
 * surfaces must land byte-identical data for the same payload, so the whole
 * pipeline — payload parse, state validation, normalization, transactional
 * persistence with rollback, custom-tool extraction — lives here and the routes
 * only authenticate and render their own envelopes.
 */

/**
 * Workflow JSON is a bounded document — a few hundred blocks at the outside.
 * Capping well below the platform-wide `DEFAULT_MAX_JSON_BODY_BYTES` (50 MB)
 * keeps a hostile caller from buffering a large body before validation runs.
 */
export const MAX_IMPORT_BODY_BYTES = 10 * 1024 * 1024

const DEFAULT_IMPORTED_WORKFLOW_NAME = 'Imported Workflow'

const TRUNCATION_SUFFIX = '...'

export interface ImportWorkflowParams {
  workspaceId: string
  folderId?: string
  /** Explicit name override; wins over payload metadata. */
  name?: string
  /** Explicit description override; wins over payload metadata. */
  description?: string
  /** Export envelope, bare state, or a JSON string of either. */
  workflow: string | Record<string, unknown>
  userId: string
  requestId: string
}

export interface ImportedWorkflow {
  id: string
  name: string
  description: string | null
  workspaceId: string
  folderId: string | null
  createdAt: Date
  updatedAt: Date
}

export type ImportWorkflowResult =
  | { success: true; workflow: ImportedWorkflow }
  | { success: false; status: number; error: string; details?: unknown }

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
 * Creates a new workflow in the target workspace from an export payload
 * produced by the export endpoints. Block, edge, loop and parallel ids are
 * regenerated on import, so the same payload can be imported repeatedly and
 * alongside its source workflow without collisions.
 *
 * The caller must have already authenticated and authorized write access to
 * `workspaceId`; this performs only resource-level checks (workspace exists,
 * folder ownership/lock state).
 */
export async function importWorkflowIntoWorkspace(
  params: ImportWorkflowParams
): Promise<ImportWorkflowResult> {
  const { workspaceId, folderId, userId, requestId } = params

  const [workspaceData] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
    .limit(1)

  if (!workspaceData) {
    return { success: false, status: 404, error: 'Workspace not found' }
  }

  /**
   * Ownership before lock state: `assertFolderMutable` walks the folder's
   * ancestor chain without filtering on workspace, so checking it first would
   * let a caller distinguish a locked folder in someone else's workspace
   * (423) from a nonexistent one (404).
   */
  try {
    if (folderId) {
      await assertFolderInWorkspace(folderId, workspaceId)
    }
    await assertFolderMutable(folderId ?? null)
  } catch (error) {
    if (error instanceof FolderLockedError || error instanceof FolderNotFoundError) {
      return { success: false, status: error.status, error: error.message }
    }
    throw error
  }

  const rawWorkflow = params.workflow
  const workflowContent =
    typeof rawWorkflow === 'string' ? rawWorkflow : JSON.stringify(rawWorkflow)

  const { data: parsedState, errors } = parseWorkflowJson(workflowContent)
  if (!parsedState || errors.length > 0) {
    return { success: false, status: 400, error: `Invalid workflow: ${errors.join(', ')}` }
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
   * strictly — so a block field with the wrong type would persist happily here
   * and then throw on every subsequent load, leaving a workflow nothing can
   * open. Gate on the same schema the canonical `PUT /api/workflows/[id]/state`
   * path enforces.
   */
  const stateValidation = workflowStateSchema.safeParse({ ...parsedState, variables })
  if (!stateValidation.success) {
    const issue = stateValidation.error.issues[0]
    const path = issue?.path.join('.')
    return {
      success: false,
      status: 400,
      error: `Invalid workflow state${path ? ` at ${path}` : ''}: ${issue?.message ?? 'validation failed'}`,
      details: serializeZodIssues(stateValidation.error),
    }
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
    params.name,
    params.description
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
    return { success: false, status, error: created.error ?? 'Failed to create workflow' }
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
    return { success: false, status: 500, error: 'Failed to save workflow state' }
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

  return {
    success: true,
    workflow: {
      id: workflowId,
      name: created.workflow.name,
      description: created.workflow.description ?? null,
      workspaceId,
      folderId: created.workflow.folderId ?? null,
      createdAt: created.workflow.createdAt,
      updatedAt: created.workflow.updatedAt,
    },
  }
}
