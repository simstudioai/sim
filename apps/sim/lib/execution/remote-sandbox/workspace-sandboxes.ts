import { db } from '@sim/db'
import { sandboxImage, workspaceSandbox } from '@sim/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import type { Sandbox } from '@/lib/api/contracts/sandboxes'
import { ensureSandboxImage } from '@/lib/execution/remote-sandbox/image-registry'
import { resolveProvider } from '@/lib/execution/remote-sandbox/provider'
import { invalidateSandboxResolution } from '@/lib/execution/remote-sandbox/resolve'
import {
  type DependencyIssue,
  hashSandboxSpec,
  type SandboxLanguage,
  validateDependencies,
} from '@/lib/execution/remote-sandbox/sandbox-spec'
import type { SandboxDependencyStrategy } from '@/lib/execution/remote-sandbox/types'

/** 403 copy for a workspace whose plan does not include sandbox authoring. */
export const MAX_PLAN_REQUIRED = 'Sandboxes require an active Max or Enterprise plan.'

/** 403 copy when the `custom-sandboxes` kill switch is off for this deployment. */
export const SANDBOXES_UNAVAILABLE = 'Sandboxes are not available on this deployment.'

export const SANDBOX_ADMIN_REQUIRED = 'Only workspace admins can manage sandboxes'

/**
 * The unique index that actually arbitrates sandbox-name collisions. Named here
 * so a write path can recognize losing the race and answer 409 rather than 500.
 */
export const WORKSPACE_SANDBOX_NAME_INDEX = 'workspace_sandbox_workspace_name_unique'

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
export class SandboxDependencyError extends Error {
  constructor(readonly issues: DependencyIssue[]) {
    super(issues[0]?.reason ?? 'Invalid dependency list')
    this.name = 'SandboxDependencyError'
  }
}

export interface SandboxSpecUpdate {
  language: SandboxLanguage
  dependencies: string[]
  specHash: string
}

/**
 * Validates a submitted list against the target language and returns the
 * canonical spec. Called on every write, including a language change, so a list
 * that was valid Python does not survive a switch to JavaScript unchecked.
 */
export function buildSpecUpdate(
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
    { language: spec.language, dependencies: spec.dependencies },
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
