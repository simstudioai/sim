import { db } from '@sim/db'
import { sandboxImage, workspaceSandbox } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import type { Sandbox } from '@/lib/api/contracts/sandboxes'
import { runDetached } from '@/lib/core/utils/background'
import {
  ensureSandboxImage,
  releaseSandboxImage,
} from '@/lib/execution/remote-sandbox/image-registry'
import { resolveProvider } from '@/lib/execution/remote-sandbox/provider'
import { invalidateSandboxResolution } from '@/lib/execution/remote-sandbox/resolve'
import {
  type DependencyIssue,
  hashSandboxSpec,
  type SandboxLanguage,
  validateDependencies,
} from '@/lib/execution/remote-sandbox/sandbox-spec'
import type { SandboxDependencyStrategy } from '@/lib/execution/remote-sandbox/types'

const logger = createLogger('WorkspaceSandboxes')

/** 403 copy for a workspace whose plan does not include sandbox authoring. */
export const MAX_PLAN_REQUIRED = 'Sandboxes require an active Max or Enterprise plan.'

export const SANDBOX_ADMIN_REQUIRED = 'Only workspace admins can manage sandboxes'

/**
 * The unique index that actually arbitrates sandbox-name collisions. Named here
 * so a write path can recognize losing the race and answer 409 rather than 500.
 */
const WORKSPACE_SANDBOX_NAME_INDEX = 'workspace_sandbox_workspace_name_unique'

/**
 * Builds cost provider compute, so every mutation shares one per-workspace
 * budget rather than giving each admin a full allowance of their own.
 */
export const SANDBOX_MUTATION_LIMIT = {
  maxTokens: 20,
  refillRate: 10,
  refillIntervalMs: 60_000,
} as const

/** Thrown when a submitted dependency list has lines the editor should mark. */
class SandboxDependencyError extends Error {
  constructor(readonly issues: DependencyIssue[]) {
    super(issues[0]?.reason ?? 'Invalid dependency list')
    this.name = 'SandboxDependencyError'
  }
}

interface SandboxSpecUpdate {
  language: SandboxLanguage
  dependencies: string[]
  specHash: string
}

/**
 * Validates a submitted list against the target language and returns the
 * canonical spec. Called on every write, including a language change, so a list
 * that was valid Python does not survive a switch to JavaScript unchecked.
 */
function buildSpecUpdate(
  language: SandboxLanguage,
  submitted: readonly string[]
): SandboxSpecUpdate {
  const validation = validateDependencies(language, submitted)
  if (!validation.ok) throw new SandboxDependencyError(validation.issues)
  return {
    language,
    dependencies: validation.dependencies,
    specHash: hashSandboxSpec({ language, dependencies: validation.dependencies }),
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
  specHash: workspaceSandbox.specHash,
  createdAt: workspaceSandbox.createdAt,
  updatedAt: workspaceSandbox.updatedAt,
} as const

/**
 * Lists a workspace's sandboxes with their build status. Under a runtime
 * provider the registry is never consulted, because it is never written.
 */
export async function listWorkspaceSandboxes(workspaceId: string): Promise<Sandbox[]> {
  const rows = await db
    .select(SANDBOX_COLUMNS)
    .from(workspaceSandbox)
    .where(eq(workspaceSandbox.workspaceId, workspaceId))
    .orderBy(workspaceSandbox.name)

  return attachBuildStatus(rows)
}

/**
 * Reads one sandbox back, scoped to its workspace. Fetches the single row rather
 * than filtering a full list — this runs after every create and update.
 */
async function readWorkspaceSandbox(
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
async function scheduleSandboxBuild(spec: SandboxSpecUpdate): Promise<void> {
  invalidateSandboxResolution()
  await ensureSandboxImage(
    { language: spec.language, dependencies: spec.dependencies },
    spec.specHash
  )
}

/** True when a name is already taken in the workspace by a different sandbox. */
async function isSandboxNameTaken(
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

/**
 * Whether a write failed because it collided with the workspace/name unique
 * index. Every write pre-checks the name, but the index is the real arbiter and
 * a concurrent write can still lose the race — which is a conflict, not a fault.
 */
function isSandboxNameConflictError(error: unknown): boolean {
  const message = getErrorMessage(error)
  return message.includes(WORKSPACE_SANDBOX_NAME_INDEX) || message.includes('23505')
}

/**
 * Why a sandbox write was refused, in terms the caller's own surface can render:
 * the REST routes map these to status codes, the copilot tool to a message.
 */
export type SandboxWriteFailure =
  | { code: 'name_conflict'; name: string }
  | { code: 'invalid_dependencies'; message: string; issues: DependencyIssue[] }
  | { code: 'not_found'; sandboxId: string }
  | { code: 'read_back_failed' }

export type SandboxWriteResult =
  | { ok: true; sandbox: Sandbox }
  | { ok: false; failure: SandboxWriteFailure }

function dependencyFailure(error: unknown): SandboxWriteFailure {
  if (error instanceof SandboxDependencyError) {
    return { code: 'invalid_dependencies', message: error.message, issues: error.issues }
  }
  throw error
}

async function readBackOrFail(workspaceId: string, sandboxId: string): Promise<SandboxWriteResult> {
  const sandbox = await readWorkspaceSandbox(workspaceId, sandboxId)
  if (!sandbox) return { ok: false, failure: { code: 'read_back_failed' } }
  return { ok: true, sandbox }
}

export interface CreateWorkspaceSandboxParams {
  workspaceId: string
  /** Attributed as `createdBy`; the caller has already authorized this actor. */
  userId: string
  name: string
  language: SandboxLanguage
  /** Raw submitted lines — comments and blanks are stripped during validation. */
  dependencies: readonly string[]
}

/**
 * Creates a sandbox and enqueues its build.
 *
 * Authorization, entitlement, and rate limiting are the caller's job: this runs
 * for both the REST route and the copilot tool, which authorize differently.
 */
export async function createWorkspaceSandbox(
  params: CreateWorkspaceSandboxParams
): Promise<SandboxWriteResult> {
  const { workspaceId, userId, name, language, dependencies } = params

  let spec: SandboxSpecUpdate
  try {
    spec = buildSpecUpdate(language, dependencies)
  } catch (error) {
    return { ok: false, failure: dependencyFailure(error) }
  }

  if (await isSandboxNameTaken(workspaceId, name)) {
    return { ok: false, failure: { code: 'name_conflict', name } }
  }

  const id = generateId()
  try {
    await db.insert(workspaceSandbox).values({
      id,
      workspaceId,
      name,
      language: spec.language,
      dependencies: spec.dependencies,
      specHash: spec.specHash,
      createdBy: userId,
    })
  } catch (error) {
    // The unique index is the real arbiter — the pre-check above only exists to
    // return a friendlier message when there is no race.
    if (isSandboxNameConflictError(error)) {
      return { ok: false, failure: { code: 'name_conflict', name } }
    }
    throw error
  }

  await scheduleSandboxBuild(spec)
  return readBackOrFail(workspaceId, id)
}

export interface UpdateWorkspaceSandboxParams {
  workspaceId: string
  sandboxId: string
  name?: string
  language?: SandboxLanguage
  dependencies?: readonly string[]
}

/**
 * Applies a partial edit and re-enqueues the build.
 *
 * The build is scheduled unconditionally, because the registry decides what a
 * save costs: a `ready` or in-flight row is left alone, so renaming or re-saving
 * an unchanged spec enqueues nothing, while a failed one gets the immediate
 * retry the caller is asking for. Gating on a changed hash meant a same-spec
 * save silently did nothing, and the only way to retry a failed build was to
 * edit the package list into a different hash.
 */
export async function updateWorkspaceSandbox(
  params: UpdateWorkspaceSandboxParams
): Promise<SandboxWriteResult> {
  const { workspaceId, sandboxId, name, language, dependencies } = params

  const [existing] = await db
    .select({
      name: workspaceSandbox.name,
      language: workspaceSandbox.language,
      dependencies: workspaceSandbox.dependencies,
      specHash: workspaceSandbox.specHash,
    })
    .from(workspaceSandbox)
    .where(and(eq(workspaceSandbox.id, sandboxId), eq(workspaceSandbox.workspaceId, workspaceId)))
    .limit(1)

  if (!existing) {
    return { ok: false, failure: { code: 'not_found', sandboxId } }
  }

  const nextName = name ?? existing.name
  if (name && name !== existing.name && (await isSandboxNameTaken(workspaceId, name, sandboxId))) {
    return { ok: false, failure: { code: 'name_conflict', name } }
  }

  // Both halves are revalidated together even when only one changed: switching
  // language has to re-check the existing list against the new language's rules,
  // and editing dependencies has to check them against the stored language.
  const nextLanguage = language ?? (existing.language as SandboxLanguage)
  const nextDependencies = dependencies ?? existing.dependencies ?? []

  let spec: SandboxSpecUpdate
  try {
    spec = buildSpecUpdate(nextLanguage, nextDependencies)
  } catch (error) {
    return { ok: false, failure: dependencyFailure(error) }
  }

  try {
    await db
      .update(workspaceSandbox)
      .set({
        name: nextName,
        language: spec.language,
        dependencies: spec.dependencies,
        specHash: spec.specHash,
        updatedAt: new Date(),
      })
      // Scoped by workspace as well as id: every other query here is, and relying on
      // the SELECT above to have 404'd first makes authz an ordering invariant.
      .where(and(eq(workspaceSandbox.id, sandboxId), eq(workspaceSandbox.workspaceId, workspaceId)))
  } catch (error) {
    if (isSandboxNameConflictError(error)) {
      return { ok: false, failure: { code: 'name_conflict', name: nextName } }
    }
    throw error
  }

  await scheduleSandboxBuild(spec)

  if (spec.specHash !== existing.specHash) {
    // The previous content address is unreferenced by this sandbox now. Release
    // no-ops when another sandbox still declares the same package list.
    runDetached('release-sandbox-image', () => releaseSandboxImage(existing.specHash))
    logger.info('Sandbox spec changed, scheduled a build', { workspaceId, sandboxId })
  }

  return readBackOrFail(workspaceId, sandboxId)
}

/**
 * Deletes a sandbox and releases its build.
 *
 * A block may still reference it. Deleting is allowed anyway; that execution
 * then fails closed with a message naming the missing sandbox, rather than
 * silently falling back to an image without its dependencies.
 */
export async function deleteWorkspaceSandbox(
  workspaceId: string,
  sandboxId: string
): Promise<{ ok: true; name: string } | { ok: false; failure: SandboxWriteFailure }> {
  const deleted = await db
    .delete(workspaceSandbox)
    .where(and(eq(workspaceSandbox.id, sandboxId), eq(workspaceSandbox.workspaceId, workspaceId)))
    .returning({
      name: workspaceSandbox.name,
      specHash: workspaceSandbox.specHash,
    })

  if (deleted.length === 0) {
    return { ok: false, failure: { code: 'not_found', sandboxId } }
  }

  invalidateSandboxResolution()
  // Detached: the row is already gone, so the caller's delete succeeded whatever
  // the provider says. Awaiting would hold a UI delete open on a remote call the
  // retention sweep would retry anyway.
  runDetached('release-sandbox-image', () => releaseSandboxImage(deleted[0].specHash))
  logger.info('Deleted workspace sandbox', { workspaceId, sandboxId })
  return { ok: true, name: deleted[0].name }
}
