import { db } from '@sim/db'
import { sandboxImage, workspaceSandbox } from '@sim/db/schema'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import type { CreateSandboxBody, Sandbox, UpdateSandboxBody } from '@/lib/api/contracts/sandboxes'
import {
  type CursorKey,
  type KeysetKey,
  keysetColumns,
  keysetPage,
  type ListSortOrder,
  listOrderBy,
  resumeKeyset,
  searchFilter,
  textKey,
  timestampKey,
} from '@/lib/api/list-query'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { runDetached } from '@/lib/core/utils/background'
import {
  canonicalizeSandboxCliTools,
  type SandboxCliToolId,
} from '@/lib/execution/remote-sandbox/cli-tools'
import { assertSandboxCliToolsSupported } from '@/lib/execution/remote-sandbox/cli-tools.server'
import {
  ensureSandboxImage,
  releaseSandboxImage,
} from '@/lib/execution/remote-sandbox/image-registry'
import { resolveProvider } from '@/lib/execution/remote-sandbox/provider'
import { invalidateSandboxResolution } from '@/lib/execution/remote-sandbox/resolve'
import {
  canonicalizeSystemPackages,
  type DependencyIssue,
  hashSandboxSpec,
  type SandboxLanguage,
  type SystemPackageIssue,
  validateDependencies,
  validateSystemPackages,
} from '@/lib/execution/remote-sandbox/sandbox-spec'
import type { SandboxDependencyStrategy } from '@/lib/execution/remote-sandbox/types'

/**
 * The unique index that actually arbitrates sandbox-name collisions. Named here
 * so a write path can recognize losing the race and answer 409 rather than 500.
 */
export const WORKSPACE_SANDBOX_NAME_INDEX = 'workspace_sandbox_workspace_name_unique'

/**
 * Saves cost provider work — a prebuilt image, or a re-install on the next run
 * under a runtime provider — so creates and updates share one per-workspace
 * budget rather than giving each admin a full allowance of their own.
 */
export const SANDBOX_MUTATION_LIMIT = {
  maxTokens: 20,
  refillRate: 10,
  refillIntervalMs: 60_000,
} as const

/**
 * Thrown when a submitted dependency list has lines the editor should mark.
 *
 * Classified as `validation` so every surface answers 400 without restating the
 * mapping; the surfaces read `issues` off it to address each refusal to the
 * submitted line.
 */
export class SandboxDependencyError extends OrchestrationError {
  constructor(readonly issues: DependencyIssue[]) {
    super('validation', issues[0]?.reason ?? 'Invalid dependency list')
    this.name = 'SandboxDependencyError'
  }
}

/** Thrown when a submitted Debian package coordinate is invalid. */
export class SandboxSystemPackageError extends OrchestrationError {
  constructor(readonly issues: SystemPackageIssue[]) {
    super('validation', issues[0]?.reason ?? 'Invalid system package list')
    this.name = 'SandboxSystemPackageError'
  }
}

export class WorkspaceSandboxNotFoundError extends OrchestrationError {
  constructor() {
    super('not_found', 'Sandbox not found')
    this.name = 'WorkspaceSandboxNotFoundError'
  }
}

export class WorkspaceSandboxNameConflictError extends OrchestrationError {
  constructor(readonly sandboxName: string) {
    super('conflict', `A sandbox named "${sandboxName}" already exists in this workspace`)
    this.name = 'WorkspaceSandboxNameConflictError'
  }
}

export interface SandboxSpecUpdate {
  language: SandboxLanguage
  dependencies: string[]
  cliTools: SandboxCliToolId[]
  systemPackages: string[]
  specHash: string
}

export interface SandboxWriteOptions {
  /**
   * Runs once the spec has validated and the name is known to be free,
   * immediately before the write that schedules a build. The build budget is
   * spent here rather than up front so a refused line or a name collision,
   * which build nothing, cannot drain it.
   */
  admit?: () => Promise<void>
}

/**
 * Validates a submitted list against the target language and returns the
 * canonical spec. Called on every write, including a language change, so a list
 * that was valid Python does not survive a switch to JavaScript unchecked.
 */
export function buildSpecUpdate(
  language: SandboxLanguage,
  submitted: readonly string[],
  submittedCliTools: readonly string[] = [],
  submittedSystemPackages: readonly string[] = []
): SandboxSpecUpdate {
  const validation = validateDependencies(language, submitted)
  if (!validation.ok) throw new SandboxDependencyError(validation.issues)
  const systemPackageValidation = validateSystemPackages(submittedSystemPackages)
  if (!systemPackageValidation.ok) {
    throw new SandboxSystemPackageError(systemPackageValidation.issues)
  }
  const cliTools = canonicalizeSandboxCliTools(submittedCliTools)
  assertSandboxCliToolsSupported(cliTools, resolveProvider().id)
  return {
    language,
    dependencies: validation.dependencies,
    cliTools,
    systemPackages: systemPackageValidation.systemPackages,
    specHash: hashSandboxSpec({
      language,
      dependencies: validation.dependencies,
      cliTools,
      systemPackages: systemPackageValidation.systemPackages,
    }),
  }
}

export function currentSandboxStrategy(): SandboxDependencyStrategy {
  return resolveProvider().dependencyStrategy
}

interface SandboxRow {
  id: string
  name: string
  language: string
  dependencies: string[] | null
  cliTools: string[] | null
  systemPackages: string[] | null
  createdAt: Date
  updatedAt: Date
}

interface ImageRow {
  status: string
  errorCode: string | null
  errorMessage: string | null
  errorDetail: string | null
  updatedAt: Date
}

function toSandbox(row: SandboxRow, image: ImageRow | undefined): Sandbox {
  return {
    id: row.id,
    name: row.name,
    language: row.language as Sandbox['language'],
    dependencies: row.dependencies ?? [],
    cliTools: canonicalizeSandboxCliTools(row.cliTools ?? []),
    systemPackages: canonicalizeSystemPackages(row.systemPackages ?? []),
    // A runtime-strategy deployment has no build, so the status is genuinely absent
    // rather than pending — the UI branches on that to explain the tradeoff.
    buildStatus: (image?.status as Sandbox['buildStatus']) ?? null,
    errorCode: image?.errorCode ?? null,
    errorMessage: image?.errorMessage ?? null,
    errorDetail: image?.errorDetail ?? null,
    builtAt: image?.status === 'ready' ? image.updatedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * Joins the build registry onto a set of sandbox rows.
 *
 * `sandbox_image` is content-addressed and shared across every workspace, so it
 * MUST be filtered by the spec hashes actually in play — selecting the whole
 * provider's rows would read the entire platform's build table (log tails and
 * all) to render one workspace's few sandboxes.
 */
async function attachBuildStatus(rows: (SandboxRow & { specHash: string })[]): Promise<Sandbox[]> {
  const provider = resolveProvider()
  if (provider.dependencyStrategy !== 'prebuilt' || rows.length === 0) {
    return rows.map((row) => toSandbox(row, undefined))
  }

  const specHashes = [...new Set(rows.map((row) => row.specHash))]
  const images = await db
    .select({
      specHash: sandboxImage.specHash,
      status: sandboxImage.status,
      errorCode: sandboxImage.errorCode,
      errorMessage: sandboxImage.errorMessage,
      errorDetail: sandboxImage.errorDetail,
      updatedAt: sandboxImage.updatedAt,
    })
    .from(sandboxImage)
    .where(and(eq(sandboxImage.provider, provider.id), inArray(sandboxImage.specHash, specHashes)))

  const byHash = new Map(images.map((image) => [image.specHash, image]))
  return rows.map((row) => toSandbox(row, byHash.get(row.specHash)))
}

const SANDBOX_COLUMNS = {
  id: workspaceSandbox.id,
  name: workspaceSandbox.name,
  language: workspaceSandbox.language,
  dependencies: workspaceSandbox.dependencies,
  cliTools: workspaceSandbox.cliTools,
  systemPackages: workspaceSandbox.systemPackages,
  specHash: workspaceSandbox.specHash,
  createdAt: workspaceSandbox.createdAt,
  updatedAt: workspaceSandbox.updatedAt,
} as const

export type SandboxSortBy = 'name' | 'createdAt' | 'updatedAt'

type SandboxListRow = SandboxRow & { specHash: string }

/** The tiebreaker every ordering ends in, so a page boundary inside a tie is exact. */
const sandboxIdKey = textKey<SandboxListRow>(workspaceSandbox.id, (row) => row.id)

const SANDBOX_SORTS = {
  name: [textKey<SandboxListRow>(workspaceSandbox.name, (row) => row.name), sandboxIdKey],
  createdAt: [
    timestampKey<SandboxListRow>(workspaceSandbox.createdAt, (row) => row.createdAt),
    sandboxIdKey,
  ],
  updatedAt: [
    timestampKey<SandboxListRow>(workspaceSandbox.updatedAt, (row) => row.updatedAt),
    sandboxIdKey,
  ],
} satisfies Record<SandboxSortBy, readonly KeysetKey<SandboxListRow>[]>

export interface WorkspaceSandboxPage {
  data: Sandbox[]
  nextCursorKeys: CursorKey[] | null
}

/**
 * Lists a workspace's sandboxes with their build status, optionally searched,
 * sorted, and keyset-paged. Without `limit` the whole set comes back in one
 * read and can never carry a cursor, which is what the settings page and
 * Copilot want; the public API passes one and resumes from `cursorKeys`.
 *
 * Under a runtime provider the build registry is never consulted, because it
 * is never written.
 */
export async function listWorkspaceSandboxesPage(params: {
  workspaceId: string
  /** Case-insensitive substring match on the sandbox name. */
  search?: string
  sortBy?: SandboxSortBy
  sortOrder?: ListSortOrder
  limit?: number
  cursorKeys?: CursorKey[]
}): Promise<WorkspaceSandboxPage> {
  const { sortBy = 'name', sortOrder = 'asc', limit } = params
  const keys = SANDBOX_SORTS[sortBy]
  const resumeAfter = resumeKeyset(keys, params.cursorKeys, sortOrder)

  const query = db
    .select(SANDBOX_COLUMNS)
    .from(workspaceSandbox)
    .where(
      and(
        eq(workspaceSandbox.workspaceId, params.workspaceId),
        searchFilter(workspaceSandbox.name, params.search),
        resumeAfter
      )
    )
    .orderBy(...listOrderBy(keysetColumns(keys), sortOrder))
  const rows = limit === undefined ? await query : await query.limit(limit + 1)

  const page = keysetPage(keys, rows, limit)
  return { data: await attachBuildStatus(page.data), nextCursorKeys: page.nextCursorKeys }
}

/** The whole set, name-ordered, for the surfaces that render every sandbox at once. */
export async function listWorkspaceSandboxes(workspaceId: string): Promise<Sandbox[]> {
  const page = await listWorkspaceSandboxesPage({ workspaceId })
  return page.data
}

/**
 * Reads one sandbox back, scoped to its workspace. Fetches the single row rather
 * than filtering a full list — this runs after every create and update.
 */
export async function readWorkspaceSandbox(
  workspaceId: string,
  sandboxId: string
): Promise<Sandbox | null> {
  const rows = await db
    .select(SANDBOX_COLUMNS)
    .from(workspaceSandbox)
    .where(and(eq(workspaceSandbox.id, sandboxId), eq(workspaceSandbox.workspaceId, workspaceId)))
    .limit(1)

  const [sandbox] = await attachBuildStatus(rows)
  return sandbox ?? null
}

/**
 * Enqueues a build for a spec, if the active provider prebuilds. Invalidating
 * the resolution cache first means an execution started right after a save never
 * reads the previous image for the edited sandbox.
 */
export async function scheduleSandboxBuild(spec: SandboxSpecUpdate): Promise<void> {
  invalidateSandboxResolution()
  await ensureSandboxImage(
    {
      language: spec.language,
      dependencies: spec.dependencies,
      cliTools: spec.cliTools,
      systemPackages: spec.systemPackages,
    },
    spec.specHash
  )
}

/** True when a name is already taken in the workspace by a different sandbox. */
export async function isSandboxNameTaken(
  workspaceId: string,
  name: string,
  excludeId?: string
): Promise<boolean> {
  const [existing] = await db
    .select({ id: workspaceSandbox.id })
    .from(workspaceSandbox)
    .where(and(eq(workspaceSandbox.workspaceId, workspaceId), eq(workspaceSandbox.name, name)))
    .limit(1)
  return Boolean(existing && existing.id !== excludeId)
}

/** Whether a write lost the workspace/name unique-index race. */
export function isWorkspaceSandboxNameConflictError(error: unknown): boolean {
  const message = getErrorMessage(error)
  return message.includes(WORKSPACE_SANDBOX_NAME_INDEX) || message.includes('23505')
}

/**
 * Creates a sandbox through the same validation, persistence, build scheduling,
 * and read-back path used by every product surface.
 */
export async function createWorkspaceSandbox(
  workspaceId: string,
  createdBy: string,
  input: CreateSandboxBody,
  options: SandboxWriteOptions = {}
): Promise<Sandbox> {
  const spec = buildSpecUpdate(
    input.language,
    input.dependencies,
    input.cliTools,
    input.systemPackages
  )

  if (await isSandboxNameTaken(workspaceId, input.name)) {
    throw new WorkspaceSandboxNameConflictError(input.name)
  }
  await options.admit?.()

  const id = generateId()
  try {
    await db.insert(workspaceSandbox).values({
      id,
      workspaceId,
      name: input.name,
      language: spec.language,
      dependencies: spec.dependencies,
      cliTools: spec.cliTools,
      systemPackages: spec.systemPackages,
      specHash: spec.specHash,
      createdBy,
    })
  } catch (error) {
    if (isWorkspaceSandboxNameConflictError(error)) {
      throw new WorkspaceSandboxNameConflictError(input.name)
    }
    throw error
  }

  await scheduleSandboxBuild(spec)
  const sandbox = await readWorkspaceSandbox(workspaceId, id)
  if (!sandbox) throw new Error('Failed to read back the created sandbox')
  return sandbox
}

/**
 * Applies a partial sandbox edit. The complete resulting spec is always
 * revalidated so language changes cannot retain dependencies from the wrong
 * registry.
 */
export async function updateWorkspaceSandbox(
  workspaceId: string,
  sandboxId: string,
  input: UpdateSandboxBody,
  options: SandboxWriteOptions = {}
): Promise<Sandbox> {
  const [existing] = await db
    .select({
      id: workspaceSandbox.id,
      name: workspaceSandbox.name,
      language: workspaceSandbox.language,
      dependencies: workspaceSandbox.dependencies,
      cliTools: workspaceSandbox.cliTools,
      systemPackages: workspaceSandbox.systemPackages,
      specHash: workspaceSandbox.specHash,
    })
    .from(workspaceSandbox)
    .where(and(eq(workspaceSandbox.id, sandboxId), eq(workspaceSandbox.workspaceId, workspaceId)))
    .limit(1)

  if (!existing) throw new WorkspaceSandboxNotFoundError()

  const nextName = input.name ?? existing.name
  if (
    input.name &&
    input.name !== existing.name &&
    (await isSandboxNameTaken(workspaceId, input.name, sandboxId))
  ) {
    throw new WorkspaceSandboxNameConflictError(input.name)
  }

  const spec = buildSpecUpdate(
    input.language ?? (existing.language as SandboxLanguage),
    input.dependencies ?? existing.dependencies ?? [],
    input.cliTools ?? existing.cliTools ?? [],
    input.systemPackages ?? existing.systemPackages ?? []
  )
  await options.admit?.()

  try {
    await db
      .update(workspaceSandbox)
      .set({
        name: nextName,
        language: spec.language,
        dependencies: spec.dependencies,
        cliTools: spec.cliTools,
        systemPackages: spec.systemPackages,
        specHash: spec.specHash,
        updatedAt: new Date(),
      })
      .where(and(eq(workspaceSandbox.id, sandboxId), eq(workspaceSandbox.workspaceId, workspaceId)))
  } catch (error) {
    if (isWorkspaceSandboxNameConflictError(error)) {
      throw new WorkspaceSandboxNameConflictError(nextName)
    }
    throw error
  }

  // The registry makes this idempotent for unchanged or in-flight specs and
  // deliberately retries a previously failed build on an explicit save.
  await scheduleSandboxBuild(spec)
  if (spec.specHash !== existing.specHash) {
    runDetached('release-sandbox-image', () => releaseSandboxImage(existing.specHash))
  }

  const sandbox = await readWorkspaceSandbox(workspaceId, sandboxId)
  if (!sandbox) throw new Error('Failed to read back the updated sandbox')
  return sandbox
}

/** Deletes a sandbox while allowing existing Function references to fail closed. */
export async function deleteWorkspaceSandbox(
  workspaceId: string,
  sandboxId: string
): Promise<void> {
  const deleted = await db
    .delete(workspaceSandbox)
    .where(and(eq(workspaceSandbox.id, sandboxId), eq(workspaceSandbox.workspaceId, workspaceId)))
    .returning({ id: workspaceSandbox.id, specHash: workspaceSandbox.specHash })

  if (deleted.length === 0) throw new WorkspaceSandboxNotFoundError()

  invalidateSandboxResolution()
  runDetached('release-sandbox-image', () => releaseSandboxImage(deleted[0].specHash))
}
