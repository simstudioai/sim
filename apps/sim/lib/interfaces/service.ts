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
import { generateRestoreName } from '@/lib/core/utils/restore-name'
import { DEFAULT_MODULE_CONFIGS } from '@/lib/interfaces/constants'
import type {
  ChatModuleConfig,
  FileModuleConfig,
  FormModuleConfig,
  InterfaceCell,
  InterfaceDefinition,
  InterfaceLayout,
  InterfaceModule,
  TableModuleConfig,
} from '@/lib/interfaces/types'
import { InterfaceLayoutError, validateLayout } from '@/lib/interfaces/validation'

const logger = createLogger('InterfaceService')

export const MAX_INTERFACE_NAME_LENGTH = 100

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

export type InterfaceListScope = 'active' | 'archived' | 'all'

export interface CreateInterfaceData {
  workspaceId: string
  name: string
  description?: string | null
  createdBy: string
}

export type AddModuleData =
  | { type: 'chat'; cell: InterfaceCell; config?: ChatModuleConfig }
  | { type: 'table'; cell: InterfaceCell; config?: TableModuleConfig }
  | { type: 'file'; cell: InterfaceCell; config?: FileModuleConfig }
  | { type: 'form'; cell: InterfaceCell; config?: FormModuleConfig }

type WorkspaceInterfaceRow = typeof workspaceInterface.$inferSelect

function emptyLayout(): InterfaceLayout {
  return { version: 1, modules: [] }
}

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
      scope === 'all'
        ? eq(workspaceInterface.workspaceId, workspaceId)
        : scope === 'archived'
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
        layout: emptyLayout(),
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
      throw new Error('Interface not found')
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
    throw new Error('Interface not found')
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
      throw new Error('Interface not found')
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
      throw new Error('Interface not found')
    }
    return toDefinition(row)
  })
}

/**
 * Replaces the full module layout after validating it.
 *
 * @throws {InterfaceStaleWriteError} when `options.expectedUpdatedAt` is
 * supplied and the interface has changed since the caller read it
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

function buildModule(id: string, data: AddModuleData): InterfaceModule {
  switch (data.type) {
    case 'chat':
      return {
        id,
        type: 'chat',
        cell: data.cell,
        config: data.config ?? DEFAULT_MODULE_CONFIGS.chat(),
      }
    case 'table':
      return {
        id,
        type: 'table',
        cell: data.cell,
        config: data.config ?? DEFAULT_MODULE_CONFIGS.table(),
      }
    case 'file':
      return {
        id,
        type: 'file',
        cell: data.cell,
        config: data.config ?? DEFAULT_MODULE_CONFIGS.file(),
      }
    case 'form':
      return {
        id,
        type: 'form',
        cell: data.cell,
        config: data.config ?? DEFAULT_MODULE_CONFIGS.form(),
      }
  }
}

/**
 * Adds a module to an empty cell. Rejects when the cell is occupied — moving
 * onto an occupied cell is a `moveModule` swap, never an add.
 */
export async function addModule(
  id: string,
  data: AddModuleData
): Promise<{ definition: InterfaceDefinition; moduleId: string }> {
  const module = buildModule(generateId(), data)

  const definition = await mutateLayout(id, (current) => {
    const occupant = current.layout.modules.find(
      (existing) => existing.cell.row === data.cell.row && existing.cell.col === data.cell.col
    )
    if (occupant) {
      throw new InterfaceLayoutError([
        `Cell (${data.cell.row}, ${data.cell.col}) is already occupied by module "${occupant.id}"`,
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
 * Moves a module to a cell. When the target cell is occupied by another
 * module, the two modules swap cells.
 */
export async function moveModule(
  id: string,
  moduleId: string,
  cell: InterfaceCell
): Promise<InterfaceDefinition> {
  const updated = await mutateLayout(id, (current) => {
    const target = current.layout.modules.find((module) => module.id === moduleId)
    if (!target) {
      throw new Error('Module not found')
    }
    return {
      ...current.layout,
      modules: current.layout.modules.map((module) => {
        if (module.id === moduleId) {
          return { ...module, cell }
        }
        if (module.cell.row === cell.row && module.cell.col === cell.col) {
          return { ...module, cell: target.cell }
        }
        return module
      }),
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
 */
export async function restoreInterface(id: string): Promise<InterfaceDefinition> {
  const definition = await getInterfaceById(id, { includeArchived: true })
  if (!definition) {
    throw new Error('Interface not found')
  }
  if (!definition.archivedAt) {
    throw new Error('Interface is not archived')
  }

  const { getWorkspaceWithOwner } = await import('@/lib/workspaces/permissions/utils')
  const workspace = await getWorkspaceWithOwner(definition.workspaceId)
  if (!workspace || workspace.archivedAt) {
    throw new Error('Cannot restore interface into an archived workspace')
  }

  /**
   * A concurrent rename/create can claim the chosen name after
   * `generateRestoreName`'s check (MVCC). Retries pick a new random suffix;
   * 23505 maps to {@link InterfaceConflictError} after exhaustion.
   */
  const maxUniqueViolationRetries = 8
  let attemptedRestoreName = ''

  for (let attempt = 0; attempt < maxUniqueViolationRetries; attempt++) {
    attemptedRestoreName = ''
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT 1 FROM workspace_interface WHERE id = ${id} FOR UPDATE`)

        attemptedRestoreName = await generateRestoreName(definition.name, async (candidate) => {
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

        await tx
          .update(workspaceInterface)
          .set({ archivedAt: null, updatedAt: new Date(), name: attemptedRestoreName })
          .where(eq(workspaceInterface.id, id))
      })
      break
    } catch (error: unknown) {
      if (getPostgresErrorCode(error) !== '23505') {
        throw error
      }
      if (attempt === maxUniqueViolationRetries - 1) {
        throw new InterfaceConflictError(attemptedRestoreName || definition.name)
      }
    }
  }

  logger.info(`Restored interface ${id} as "${attemptedRestoreName}"`)

  const restored = await getInterfaceById(id)
  if (!restored) {
    throw new Error('Interface not found')
  }
  return restored
}
