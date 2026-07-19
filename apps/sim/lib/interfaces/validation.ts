/**
 * Layout validation for workspace interfaces.
 *
 * `validateLayout` is the single semantic gate for every layout write — the
 * API routes, the copilot `user_interface` tool, and the granular service
 * module operations all pass through it. Structural invariants (module count,
 * unique ids/cells, form-field rules, bounds) are enforced by running the
 * SAME zod schema the HTTP boundary contract declares
 * (`@/lib/interfaces/schema`), so the two paths cannot drift; on top of that
 * it asserts that every non-null resource reference resolves to an entity in
 * the SAME workspace (confused-deputy defense). Null references are allowed
 * at rest (unconfigured modules); dangling references are tolerated at read
 * time — renderers show a missing-resource state.
 *
 * Reference checking is **differential**: callers pass the layout being
 * replaced as `previous`, and any reference already present there is
 * grandfathered in. Without this, archiving a single referenced table would
 * make every later write to the interface fail — an interface that renders a
 * missing-resource state but can never be edited again. Grandfathering is
 * safe because a carried-over reference was already proven to belong to this
 * workspace when it was introduced, and an interface never changes workspace;
 * every new or changed reference is still checked in full.
 *
 * Every reference check runs on the caller-supplied `executor`. `mutateLayout`
 * validates while holding a row lock, so the checks must join that transaction
 * rather than reach for the global pool — a second checkout held open by the
 * transaction's own connection deadlocks the pool at saturation, and the
 * `db.transaction` tripwire rejects it outright outside production.
 */

import { db } from '@sim/db'
import { workflow, workspaceFiles } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import type { DbOrTx } from '@/lib/db/types'
import { interfaceLayoutSchema } from '@/lib/interfaces/schema'
import type { InterfaceLayout, InterfaceModule } from '@/lib/interfaces/types'
import { getTableById } from '@/lib/table'

/** Structural layout invariant violation — maps to HTTP 400. */
export class InterfaceLayoutError extends Error {
  readonly code = 'INVALID_INTERFACE_LAYOUT' as const
  readonly errors: string[]

  constructor(errors: string[]) {
    super(errors.join('; '))
    this.errors = errors
  }
}

export type InterfaceModuleReferenceType = 'workflow' | 'table' | 'file'

/** A module references a resource that does not exist in the interface's workspace — maps to HTTP 400. */
export class InvalidModuleReferenceError extends Error {
  readonly code = 'INVALID_MODULE_REFERENCE' as const
  readonly moduleId: string
  readonly refType: InterfaceModuleReferenceType
  readonly refId: string

  constructor(moduleId: string, refType: InterfaceModuleReferenceType, refId: string) {
    super(
      `${refType === 'workflow' ? 'Workflow' : refType === 'table' ? 'Table' : 'File'} "${refId}" referenced by module "${moduleId}" was not found in this workspace`
    )
    this.moduleId = moduleId
    this.refType = refType
    this.refId = refId
  }
}

/** Renders one zod issue as `path: message`, e.g. `modules[0].config.fields[2].name: ...`. */
function formatLayoutIssue(issue: { path: PropertyKey[]; message: string }): string {
  let path = ''
  for (const segment of issue.path) {
    path +=
      typeof segment === 'number' ? `[${segment}]` : path ? `.${String(segment)}` : String(segment)
  }
  return path ? `${path}: ${issue.message}` : issue.message
}

async function assertWorkflowInWorkspace(
  workspaceId: string,
  moduleId: string,
  workflowId: string,
  executor: DbOrTx
): Promise<void> {
  const rows = await executor
    .select({ id: workflow.id, workspaceId: workflow.workspaceId })
    .from(workflow)
    .where(and(eq(workflow.id, workflowId), isNull(workflow.archivedAt)))
    .limit(1)
  if (rows.length === 0 || rows[0].workspaceId !== workspaceId) {
    throw new InvalidModuleReferenceError(moduleId, 'workflow', workflowId)
  }
}

async function assertTableInWorkspace(
  workspaceId: string,
  moduleId: string,
  tableId: string,
  executor: DbOrTx
): Promise<void> {
  const table = await getTableById(tableId, { tx: executor })
  if (!table || table.workspaceId !== workspaceId) {
    throw new InvalidModuleReferenceError(moduleId, 'table', tableId)
  }
}

/**
 * Queried inline rather than through `getWorkspaceFile`, which is pinned to the
 * global `db` handle and so cannot join the caller's transaction. It also
 * collapses every failure into `null`, which would report an infrastructure
 * error as a missing reference — a file that plainly exists rejected with
 * "was not found in this workspace".
 */
async function assertFileInWorkspace(
  workspaceId: string,
  moduleId: string,
  fileId: string,
  executor: DbOrTx
): Promise<void> {
  const rows = await executor
    .select({ id: workspaceFiles.id })
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.id, fileId),
        eq(workspaceFiles.workspaceId, workspaceId),
        eq(workspaceFiles.context, 'workspace'),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .limit(1)
  if (rows.length === 0) {
    throw new InvalidModuleReferenceError(moduleId, 'file', fileId)
  }
}

export interface ModuleReference {
  type: InterfaceModuleReferenceType
  id: string
}

/**
 * The single resource a module points at, or null when it is unconfigured.
 *
 * Exported because it is the authority the public share routes derive a
 * resource id from: a token-scoped request supplies only `(token, moduleId)`
 * and this function *produces* the id from the STORED layout, so there is
 * nothing for a caller to forge. Callers outside layout validation must still
 * re-assert that the resolved entity lives in the interface's workspace —
 * {@link validateLayout} grandfathers references it has already seen.
 */
export function moduleReference(module: InterfaceModule): ModuleReference | null {
  switch (module.type) {
    case 'chat':
    case 'form':
      return module.config.workflowId === null
        ? null
        : { type: 'workflow', id: module.config.workflowId }
    case 'table':
      return module.config.tableId === null ? null : { type: 'table', id: module.config.tableId }
    case 'file':
      return module.config.fileId === null ? null : { type: 'file', id: module.config.fileId }
  }
}

function referenceKey(ref: ModuleReference): string {
  return `${ref.type}:${ref.id}`
}

/** Reference keys already persisted in `layout` — these are grandfathered in. */
function collectReferenceKeys(layout: InterfaceLayout | undefined): Set<string> {
  const keys = new Set<string>()
  if (!layout || !Array.isArray(layout.modules)) return keys
  for (const module of layout.modules) {
    const ref = moduleReference(module)
    if (ref) keys.add(referenceKey(ref))
  }
  return keys
}

/**
 * Validates a full interface layout before it is persisted.
 *
 * @param previous the layout being replaced. References it already contains
 * are not re-checked, so an interface whose table/file/workflow was archived
 * stays editable. Omit it to check every reference (creation, or any write
 * with no known prior state).
 * @param executor the transaction to run the reference checks on. Callers
 * validating inside a transaction MUST pass their `tx` handle; defaults to the
 * global pool for the standalone pre-flight case.
 * @throws {InterfaceLayoutError} when a structural invariant is violated
 * @throws {InvalidModuleReferenceError} when a new or changed workflow/table/
 * file reference does not resolve to an entity in `workspaceId`
 */
export async function validateLayout(
  workspaceId: string,
  layout: InterfaceLayout,
  previous?: InterfaceLayout,
  executor: DbOrTx = db
): Promise<void> {
  const parsed = interfaceLayoutSchema.safeParse(layout)
  if (!parsed.success) {
    throw new InterfaceLayoutError(parsed.error.issues.map(formatLayoutIssue))
  }

  const grandfathered = collectReferenceKeys(previous)

  /**
   * Checked one at a time rather than through `Promise.all`: `executor` is
   * usually a transaction handle with a single reserved connection, and the
   * count is bounded by {@link INTERFACE_LAYOUT_LIMITS.MAX_MODULES} — zero on
   * the layout-only autosave path that dominates traffic. Sequential also
   * fails fast on the first bad reference and makes which one is reported
   * deterministic rather than a race.
   */
  for (const module of layout.modules) {
    const ref = moduleReference(module)
    if (!ref || grandfathered.has(referenceKey(ref))) continue

    switch (ref.type) {
      case 'workflow':
        await assertWorkflowInWorkspace(workspaceId, module.id, ref.id, executor)
        break
      case 'table':
        await assertTableInWorkspace(workspaceId, module.id, ref.id, executor)
        break
      case 'file':
        await assertFileInWorkspace(workspaceId, module.id, ref.id, executor)
        break
    }
  }
}
