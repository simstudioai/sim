/**
 * Interface service layer — the single choke point for all workspace
 * interface persistence. Shared by the API routes, the form submit route,
 * and the copilot `user_interface` tool — never bypass it with direct DB
 * access.
 *
 * Every layout write (full replace and the granular module operations) runs
 * through `mutateLayout`, which re-reads the row under `FOR UPDATE` inside a
 * transaction and applies the caller's mutation to the *committed* layout.
 * Read-modify-write on a JSON column has no last-writer-wins semantics worth
 * having — the assistant dispatches a turn's tool calls concurrently, so two
 * parallel `add_module` calls would otherwise both read an empty module list
 * and one module would vanish while both calls reported success.
 *
 * Every write also runs through `validateLayout`, which enforces structural
 * invariants and same-workspace resource references. Audit logging is the
 * caller's responsibility (API routes / copilot tool), so service-level calls
 * never double-log.
 */

import { db } from '@sim/db'
import { workspaceInterface } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { generateRestoreName, restoreWithUniqueName } from '@/lib/core/utils/restore-name'
import {
  createEmptyLayout,
  createInterfaceModule,
  MAX_INTERFACE_NAME_LENGTH,
} from '@/lib/interfaces/constants'
import { moveModuleToCell, overlappingModules } from '@/lib/interfaces/geometry'
import type {
  ChatModuleConfig,
  FileModuleConfig,
  FormModuleConfig,
  InterfaceCell,
  InterfaceDefinition,
  InterfaceLayout,
  InterfaceModule,
  InterfacePlacement,
  TableModuleConfig,
} from '@/lib/interfaces/types'
import { InterfaceLayoutError, validateLayout } from '@/lib/interfaces/validation'

const logger = createLogger('InterfaceService')

export class InterfaceConflictError extends Error {
  readonly code = 'INTERFACE_EXISTS' as const
  constructor(name: string) {
    super(`An interface named "${name}" already exists in this workspace`)
  }
}

/**
 * Raised when a write carries an `expectedUpdatedAt` that no longer matches
 * the stored row — someone else (a teammate, or the assistant) changed the
 * interface first. Maps to HTTP 409.
 */
export class InterfaceStaleWriteError extends Error {
  readonly code = 'INTERFACE_STALE_WRITE' as const
  constructor() {
    super('This interface was changed by someone else. Reload to get the latest version.')
  }
}

/**
 * Raised when the interface a write targets no longer resolves — it never
 * existed, or a teammate archived it between the caller's access check and the
 * write. Maps to HTTP 404, matching the shape the route guard already returns
 * for an unresolvable id.
 */
export class InterfaceNotFoundError extends Error {
  readonly code = 'INTERFACE_NOT_FOUND' as const
  constructor() {
    super('Interface not found')
  }
}

/**
 * Raised when a restore targets an interface that is already active — a
 * double-clicked restore button, or two clients racing the same restore. Maps
 * to HTTP 409.
 */
export class InterfaceNotArchivedError extends Error {
  readonly code = 'INTERFACE_NOT_ARCHIVED' as const
  constructor() {
    super('Interface is not archived')
  }
}

/**
 * Raised when a restore targets an interface whose workspace is itself
 * archived. Nothing about the request is malformed — the destination is in a
 * state that cannot accept the write. Maps to HTTP 409.
 */
export class InterfaceWorkspaceArchivedError extends Error {
  readonly code = 'INTERFACE_WORKSPACE_ARCHIVED' as const
  constructor() {
    super('Cannot restore interface into an archived workspace')
  }
}

export type InterfaceListScope = 'active' | 'archived'

export interface CreateInterfaceData {
  workspaceId: string
  name: string
  description?: string | null
  createdBy: string
}

export type AddModuleData =
  | { type: 'chat'; placement: InterfacePlacement; config?: ChatModuleConfig }
  | { type: 'table'; placement: InterfacePlacement; config?: TableModuleConfig }
  | { type: 'file'; placement: InterfacePlacement; config?: FileModuleConfig }
  | { type: 'form'; placement: InterfacePlacement; config?: FormModuleConfig }

type WorkspaceInterfaceRow = typeof workspaceInterface.$inferSelect

function toDefinition(row: WorkspaceInterfaceRow): InterfaceDefinition {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    layout: row.layout as InterfaceLayout,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  }
}

function assertValidName(name: string): void {
  if (name.trim().length === 0) {
    throw new Error('Interface name is required')
  }
  if (name.length > MAX_INTERFACE_NAME_LENGTH) {
    throw new Error(
      `Interface name exceeds maximum length (${MAX_INTERFACE_NAME_LENGTH} characters)`
    )
  }
}

/**
 * Lists interfaces in a workspace, ordered by creation time.
 */
export async function listInterfaces(
  workspaceId: string,
  options?: { scope?: InterfaceListScope }
): Promise<InterfaceDefinition[]> {
  const { scope = 'active' } = options ?? {}
  const rows = await db
    .select()
    .from(workspaceInterface)
    .where(
      scope === 'archived'
        ? and(
            eq(workspaceInterface.workspaceId, workspaceId),
            sql`${workspaceInterface.archivedAt} IS NOT NULL`
          )
        : and(
            eq(workspaceInterface.workspaceId, workspaceId),
            isNull(workspaceInterface.archivedAt)
          )
    )
    .orderBy(workspaceInterface.createdAt)

  return rows.map(toDefinition)
}

/**
 * Gets an interface by id, or null when it does not exist (or is archived,
 * unless `includeArchived` is set).
 */
export async function getInterfaceById(
  id: string,
  options?: { includeArchived?: boolean }
): Promise<InterfaceDefinition | null> {
  const { includeArchived = false } = options ?? {}
  const rows = await db
    .select()
    .from(workspaceInterface)
    .where(
      includeArchived
        ? eq(workspaceInterface.id, id)
        : and(eq(workspaceInterface.id, id), isNull(workspaceInterface.archivedAt))
    )
    .limit(1)

  if (rows.length === 0) return null
  return toDefinition(rows[0])
}

/**
 * Creates an interface with an empty layout.
 *
 * @throws {InterfaceConflictError} when an active interface with the same name exists
 */
export async function createInterface(data: CreateInterfaceData): Promise<InterfaceDefinition> {
  assertValidName(data.name)

  const now = new Date()
  try {
    const [row] = await db
      .insert(workspaceInterface)
      .values({
        id: generateId(),
        workspaceId: data.workspaceId,
        name: data.name,
        description: data.description ?? null,
        layout: createEmptyLayout(),
        archivedAt: null,
        createdBy: data.createdBy,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    logger.info(`Created interface ${row.id} in workspace ${data.workspaceId}`)
    return toDefinition(row)
  } catch (error: unknown) {
    if (getPostgresErrorCode(error) === '23505') {
      throw new InterfaceConflictError(data.name)
    }
    throw error
  }
}

/**
 * Renames an interface.
 *
 * @throws {InterfaceConflictError} when the new name conflicts with an active interface
 * @throws {InterfaceNotFoundError} when the interface no longer exists
 */
export async function renameInterface(id: string, newName: string): Promise<InterfaceDefinition> {
  assertValidName(newName)

  try {
    const [row] = await db
      .update(workspaceInterface)
      .set({ name: newName, updatedAt: new Date() })
      .where(eq(workspaceInterface.id, id))
      .returning()

    if (!row) {
      throw new InterfaceNotFoundError()
    }
    logger.info(`Renamed interface ${id} to "${newName}"`)
    return toDefinition(row)
  } catch (error: unknown) {
    if (getPostgresErrorCode(error) === '23505') {
      throw new InterfaceConflictError(newName)
    }
    throw error
  }
}

/**
 * Updates an interface's description (null clears it).
 *
 * @throws {InterfaceNotFoundError} when the interface no longer exists
 */
export async function updateInterfaceDescription(
  id: string,
  description: string | null
): Promise<InterfaceDefinition> {
  const [row] = await db
    .update(workspaceInterface)
    .set({ description, updatedAt: new Date() })
    .where(eq(workspaceInterface.id, id))
    .returning()

  if (!row) {
    throw new InterfaceNotFoundError()
  }
  return toDefinition(row)
}

/**
 * Derives the next layout from the interface as it exists *right now*, inside
 * the transaction. Throwing from here aborts the write.
 */
type LayoutMutation = (current: InterfaceDefinition) => InterfaceLayout

interface MutateLayoutOptions {
  /**
   * The `updatedAt` the caller believes it is editing. When it no longer
   * matches the locked row, the write is rejected as stale instead of
   * clobbering the other writer.
   */
  expectedUpdatedAt?: string
}

/**
 * Applies `mutate` to the committed layout under a row lock, validates the
 * result, and persists it — the only path that writes the layout column.
 *
 * The lock is taken before the read, so concurrent callers serialize: the
 * second one sees the first one's modules rather than the snapshot it started
 * from. `validateLayout` receives the pre-image so references that were
 * already stored are not re-checked, and archiving a referenced resource
 * cannot brick later edits.
 *
 * It also receives `tx`: its reference checks run on this transaction's
 * connection, never the global pool. A pooled checkout taken while this
 * transaction holds both a connection and a row lock can deadlock the pool at
 * saturation, so the `db.transaction` tripwire rejects it outside production.
 *
 * @throws {InterfaceStaleWriteError} when `expectedUpdatedAt` does not match
 * @throws {InterfaceNotFoundError} when the interface was archived or deleted
 * before the lock was taken
 */
async function mutateLayout(
  id: string,
  mutate: LayoutMutation,
  options?: MutateLayoutOptions
): Promise<InterfaceDefinition> {
  const { expectedUpdatedAt } = options ?? {}

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT 1 FROM workspace_interface WHERE id = ${id} FOR UPDATE`)

    const rows = await tx
      .select()
      .from(workspaceInterface)
      .where(and(eq(workspaceInterface.id, id), isNull(workspaceInterface.archivedAt)))
      .limit(1)

    if (rows.length === 0) {
      throw new InterfaceNotFoundError()
    }
    const current = toDefinition(rows[0])

    /**
     * Compared as the ISO string the caller was handed rather than through a
     * SQL timestamp predicate: the row is already locked, so this is exact,
     * and it sidesteps the millisecond/microsecond mismatch between a JS
     * `Date` and a postgres `timestamp`.
     */
    if (expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt) {
      throw new InterfaceStaleWriteError()
    }

    const layout = mutate(current)
    await validateLayout(current.workspaceId, layout, current.layout, tx)

    const [row] = await tx
      .update(workspaceInterface)
      .set({ layout, updatedAt: new Date() })
      .where(eq(workspaceInterface.id, id))
      .returning()

    if (!row) {
      throw new InterfaceNotFoundError()
    }
    return toDefinition(row)
  })
}

/**
 * Replaces the full module layout after validating it.
 *
 * @throws {InterfaceStaleWriteError} when `options.expectedUpdatedAt` is
 * supplied and the interface has changed since the caller read it
 * @throws {InterfaceNotFoundError} when the interface no longer resolves
 */
export async function updateInterfaceLayout(
  id: string,
  layout: InterfaceLayout,
  options?: MutateLayoutOptions
): Promise<InterfaceDefinition> {
  const updated = await mutateLayout(id, () => layout, options)
  logger.info(`Updated layout of interface ${id} (${layout.modules.length} modules)`)
  return updated
}

/**
 * Delegates construction to {@link createInterfaceModule} so server-minted
 * modules stay byte-identical to canvas-minted ones. The `AddModuleData`
 * union guarantees a supplied config matches the module type, and
 * `validateLayout` re-checks the persisted result.
 */
function buildModule(id: string, data: AddModuleData): InterfaceModule {
  const module = createInterfaceModule(id, data.type, data.placement)
  return data.config ? ({ ...module, config: data.config } as InterfaceModule) : module
}

/**
 * Adds a module to free space. Rejects when the target area is occupied —
 * landing on an occupied area is a `moveModule` swap, never an add. Whether
 * the placement fits the grid at all is left to `validateLayout`, which
 * reports it against the layout's own dimensions.
 */
export async function addModule(
  id: string,
  data: AddModuleData
): Promise<{ definition: InterfaceDefinition; moduleId: string }> {
  const module = buildModule(generateId(), data)

  const definition = await mutateLayout(id, (current) => {
    const [occupant] = overlappingModules(current.layout, data.placement)
    if (occupant) {
      throw new InterfaceLayoutError([
        `Cell (${data.placement.row}, ${data.placement.col}) is already occupied by module "${occupant.id}"`,
      ])
    }
    return { ...current.layout, modules: [...current.layout.modules, module] }
  })

  logger.info(`Added ${data.type} module ${module.id} to interface ${id}`)
  return { definition, moduleId: module.id }
}

/**
 * Fully replaces a module's config. The config shape must match the module's
 * type — `validateLayout` rejects mismatches.
 */
export async function updateModuleConfig(
  id: string,
  moduleId: string,
  config: InterfaceModule['config']
): Promise<InterfaceDefinition> {
  const updated = await mutateLayout(id, (current) => {
    if (!current.layout.modules.some((module) => module.id === moduleId)) {
      throw new Error('Module not found')
    }
    return {
      ...current.layout,
      modules: current.layout.modules.map((module) =>
        module.id === moduleId ? ({ ...module, config } as InterfaceModule) : module
      ),
    }
  })

  logger.info(`Updated config of module ${moduleId} on interface ${id}`)
  return updated
}

/**
 * Moves a module so its top-left corner lands on `cell`. When exactly that
 * area is held by one other module of the same size, the two swap.
 *
 * The move itself is {@link moveModuleToCell} — the same pure function the
 * editor applies optimistically — so the persisted result cannot disagree with
 * what the canvas already drew.
 */
export async function moveModule(
  id: string,
  moduleId: string,
  cell: InterfaceCell
): Promise<InterfaceDefinition> {
  const updated = await mutateLayout(id, (current) => {
    const outcome = moveModuleToCell(current.layout, moduleId, cell)
    switch (outcome.status) {
      case 'moved':
        return outcome.layout
      case 'unchanged':
        if (!current.layout.modules.some((module) => module.id === moduleId)) {
          throw new Error('Module not found')
        }
        return current.layout
      case 'out-of-bounds':
        throw new InterfaceLayoutError([
          `Cell (${cell.row}, ${cell.col}) is outside the ${current.layout.grid.rows}x${current.layout.grid.cols} grid`,
        ])
      case 'blocked':
        throw new InterfaceLayoutError([
          `Cell (${cell.row}, ${cell.col}) is already occupied by module "${outcome.blockedBy[0].id}"`,
        ])
    }
  })

  logger.info(`Moved module ${moduleId} to cell (${cell.row}, ${cell.col}) on interface ${id}`)
  return updated
}

/**
 * Removes a module from the layout.
 */
export async function removeModule(id: string, moduleId: string): Promise<InterfaceDefinition> {
  const updated = await mutateLayout(id, (current) => {
    if (!current.layout.modules.some((module) => module.id === moduleId)) {
      throw new Error('Module not found')
    }
    return {
      ...current.layout,
      modules: current.layout.modules.filter((module) => module.id !== moduleId),
    }
  })

  logger.info(`Removed module ${moduleId} from interface ${id}`)
  return updated
}

/**
 * Archives an interface (soft delete). No-op when already archived.
 */
export async function deleteInterface(id: string): Promise<void> {
  const now = new Date()
  await db
    .update(workspaceInterface)
    .set({ archivedAt: now, updatedAt: now })
    .where(and(eq(workspaceInterface.id, id), isNull(workspaceInterface.archivedAt)))

  logger.info(`Archived interface ${id}`)
}

/**
 * Restores an archived interface. When the original name is taken by an
 * active interface, a suffixed restore name is chosen.
 *
 * @throws {InterfaceConflictError} when no conflict-free name can be claimed
 * @throws {InterfaceNotFoundError} when the interface does not exist
 * @throws {InterfaceNotArchivedError} when the interface is already active
 * @throws {InterfaceWorkspaceArchivedError} when the owning workspace is archived
 */
export async function restoreInterface(id: string): Promise<InterfaceDefinition> {
  const definition = await getInterfaceById(id, { includeArchived: true })
  if (!definition) {
    throw new InterfaceNotFoundError()
  }
  if (!definition.archivedAt) {
    throw new InterfaceNotArchivedError()
  }

  const { getWorkspaceWithOwner } = await import('@/lib/workspaces/permissions/utils')
  const workspace = await getWorkspaceWithOwner(definition.workspaceId)
  if (!workspace || workspace.archivedAt) {
    throw new InterfaceWorkspaceArchivedError()
  }

  const restoredName = await restoreWithUniqueName(
    definition.name,
    (attemptedName) => new InterfaceConflictError(attemptedName),
    (reportAttemptedName) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`SELECT 1 FROM workspace_interface WHERE id = ${id} FOR UPDATE`)

        const name = await generateRestoreName(definition.name, async (candidate) => {
          const matches = await tx
            .select({ id: workspaceInterface.id })
            .from(workspaceInterface)
            .where(
              and(
                eq(workspaceInterface.workspaceId, definition.workspaceId),
                eq(workspaceInterface.name, candidate),
                isNull(workspaceInterface.archivedAt)
              )
            )
            .limit(1)
          return matches.length > 0
        })
        reportAttemptedName(name)

        await tx
          .update(workspaceInterface)
          .set({ archivedAt: null, updatedAt: new Date(), name })
          .where(eq(workspaceInterface.id, id))
        return name
      })
  )

  logger.info(`Restored interface ${id} as "${restoredName}"`)

  const restored = await getInterfaceById(id)
  if (!restored) {
    throw new InterfaceNotFoundError()
  }
  return restored
}
