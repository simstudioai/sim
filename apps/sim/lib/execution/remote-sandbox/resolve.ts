import { createLogger } from '@sim/logger'
import { CodeLanguage } from '@/lib/execution/languages'
import { classifyInstallOutput, tailBuildLog } from '@/lib/execution/remote-sandbox/build-errors'
import { resolveProvider } from '@/lib/execution/remote-sandbox/provider'
import {
  isSandboxLanguage,
  renderDependencyManifest,
  type SandboxLanguage,
  SIM_DEPS_DIR,
  SIM_NODE_MODULES_DIR,
  SIM_PACKAGE_JSON_PATH,
  SIM_REQUIREMENTS_PATH,
} from '@/lib/execution/remote-sandbox/sandbox-spec'
import type {
  SandboxDependencyStrategy,
  SandboxHandle,
  SandboxKind,
} from '@/lib/execution/remote-sandbox/types'

const logger = createLogger('SandboxResolve')

/**
 * The DB is reached lazily so the sandbox barrel stays importable without one.
 * `withPiSandbox`, the copilot doc compilers, and `verify-sandbox-parity.ts` all
 * pull in this module through `remote-sandbox/index.ts` but never select a
 * workspace sandbox — a static `@sim/db` import would make every one of them
 * throw at module load when `DATABASE_URL` is unset.
 */
async function sandboxDb() {
  const [{ db }, schema, orm] = await Promise.all([
    import('@sim/db'),
    import('@sim/db/schema'),
    import('drizzle-orm'),
  ])
  return {
    db,
    sandboxImage: schema.sandboxImage,
    workspaceSandbox: schema.workspaceSandbox,
    and: orm.and,
    eq: orm.eq,
  }
}

/**
 * Ceiling on a dependency install.
 *
 * This is an upper bound, not a separate allowance: the caller carves the actual
 * budget out of the execution timeout it is itself willing to wait for (see
 * `installBudgetMs` in the sandbox barrel). Letting the install run past that
 * would only produce a bare client-side "Request timed out" in place of the
 * classified installer error.
 */
export const RUNTIME_INSTALL_TIMEOUT_MS = 240_000

/**
 * How long a resolved BUILD stays cached in-process.
 *
 * Only the content-addressed half is cached: `sandbox_image` is keyed by
 * `(provider, specHash)`, and a spec hash names one immutable dependency set, so
 * a hit can never describe the wrong packages. The `workspace_sandbox` row is
 * re-read every time (one indexed lookup) because it is the mutable half — that
 * is what makes a delete or an edit take effect immediately on EVERY replica
 * rather than only the one that served the mutation.
 */
const IMAGE_TTL_MS = 30_000

/** `lastUsedAt` is a retention signal, not an audit trail — hourly is precise enough. */
const LAST_USED_DEBOUNCE_MS = 60 * 60 * 1000

/** Only these kinds honor a workspace sandbox; see {@link resolveWorkspaceSandbox}. */
const SANDBOX_AWARE_KINDS: ReadonlySet<SandboxKind> = new Set<SandboxKind>(['code', 'shell'])

export interface ResolvedSandbox {
  id: string
  name: string
  language: SandboxLanguage
  dependencies: string[]
  strategy: SandboxDependencyStrategy
  /** Provider image to create from. Present under the `prebuilt` strategy. */
  imageRef?: string
  /** Environment the execution must carry for the dependencies to be importable. */
  envs?: Record<string, string>
}

/** A `sandbox_image` row, cached by its content address. */
interface CachedImage {
  status: string
  imageRef: string | null
  errorMessage: string | null
}

interface CacheEntry {
  expiresAt: number
  value: CachedImage
}

/**
 * Both maps are process-lifetime and keyed by an unbounded space (every spec
 * hash ever executed), so each drops its oldest entry rather than growing for
 * the life of the worker.
 */
const IMAGE_CACHE_LIMIT = 1000
const LAST_USED_CACHE_LIMIT = 1000

const imageCache = new Map<string, CacheEntry>()
const lastUsedWrites = new Map<string, number>()

/**
 * JavaScript packages live outside the default resolution roots, so Node needs
 * `NODE_PATH` to find them. Both strategies install into the same directory, so
 * both hand back the same environment.
 */
function envsFor(language: SandboxLanguage): Record<string, string> | undefined {
  return language === CodeLanguage.JavaScript ? { NODE_PATH: SIM_NODE_MODULES_DIR } : undefined
}

/**
 * Records that a build was used, so the retention sweep can tell a live image
 * from an abandoned one. Debounced and fire-and-forget: this is bookkeeping, and
 * a failed write must never fail an execution.
 */
function touchImage(specHash: string, provider: string): void {
  const key = `${provider}:${specHash}`
  const now = Date.now()
  const written = lastUsedWrites.get(key)
  if (written && now - written < LAST_USED_DEBOUNCE_MS) return
  if (lastUsedWrites.size >= LAST_USED_CACHE_LIMIT) lastUsedWrites.clear()
  lastUsedWrites.set(key, now)
  void sandboxDb()
    .then(({ db, sandboxImage, and, eq }) =>
      db
        .update(sandboxImage)
        .set({ lastUsedAt: new Date() })
        .where(and(eq(sandboxImage.provider, provider), eq(sandboxImage.specHash, specHash)))
    )
    .catch((error) => logger.warn('Failed to record sandbox image use', { specHash, error }))
}

/**
 * Resolves the sandbox an execution should run against, or `null` when none is
 * selected (today's behavior: the env-configured template, no install step).
 *
 * Fails closed rather than degrading. A selection that cannot be honored —
 * deleted, cross-workspace, wrong language, or a build that is not `ready` —
 * throws with the reason, because the alternative is a baffling
 * `ModuleNotFoundError` inside the user's code.
 *
 * Deliberately not plan-gated: the gate covers creating and editing sandboxes,
 * so a workspace that downgrades keeps executing the ones it already has.
 */
export async function resolveWorkspaceSandbox(args: {
  kind: SandboxKind
  /**
   * The language the caller will execute. Omitted by the shell path, which runs
   * commands rather than a language runtime and so has nothing to mismatch.
   */
  language?: CodeLanguage
  workspaceId?: string
  sandboxId?: string
}): Promise<ResolvedSandbox | null> {
  const { kind, language, workspaceId, sandboxId } = args
  if (!sandboxId) return null
  // `doc` and `pi` keep their vetted images unconditionally.
  if (!SANDBOX_AWARE_KINDS.has(kind)) return null
  if (!workspaceId) {
    throw new Error('A sandbox was selected but this execution has no workspace to resolve it in')
  }

  const provider = resolveProvider()
  const { db, sandboxImage, workspaceSandbox, and, eq } = await sandboxDb()
  const [row] = await db
    .select({
      id: workspaceSandbox.id,
      name: workspaceSandbox.name,
      language: workspaceSandbox.language,
      dependencies: workspaceSandbox.dependencies,
      specHash: workspaceSandbox.specHash,
    })
    .from(workspaceSandbox)
    .where(and(eq(workspaceSandbox.id, sandboxId), eq(workspaceSandbox.workspaceId, workspaceId)))
    .limit(1)

  if (!row) {
    throw new Error(
      `The selected sandbox no longer exists in this workspace. Pick another one, or clear the selection to run on the default image.`
    )
  }
  if (!isSandboxLanguage(row.language)) {
    throw new Error(`Sandbox "${row.name}" has an unsupported language (${row.language})`)
  }

  const base = {
    id: row.id,
    name: row.name,
    language: row.language,
    dependencies: row.dependencies ?? [],
    envs: envsFor(row.language),
  }

  let resolved: ResolvedSandbox
  if (base.dependencies.length === 0) {
    // A sandbox with no packages declares nothing to build and nothing to
    // install, so it resolves to the base image under either strategy. Looking
    // for a build row here would fail closed on an image that never existed.
    resolved = { ...base, strategy: provider.dependencyStrategy }
  } else if (provider.dependencyStrategy === 'runtime') {
    resolved = { ...base, strategy: 'runtime' }
  } else {
    const image = await readImage(provider.id, row.specHash)

    if (!image || image.status !== 'ready' || !image.imageRef) {
      await scheduleImageRepair(base, row.specHash)
      throw new Error(describeUnusableImage(row.name, image?.status, image?.errorMessage))
    }
    touchImage(row.specHash, provider.id)
    resolved = { ...base, strategy: 'prebuilt', imageRef: image.imageRef }
  }

  assertLanguageMatches(resolved, language)
  return resolved
}

/**
 * Reads a build row, memoized on its content address.
 *
 * A `ready` row is terminal for that spec hash, so caching it cannot go stale in
 * a way that matters — editing a sandbox produces a different hash, and deleting
 * one is caught by the `workspace_sandbox` read that always runs. A non-ready
 * row is NOT cached: it is precisely the value that flips underneath us while a
 * build completes, and caching it would keep a just-finished build unusable.
 */
async function readImage(providerId: string, specHash: string): Promise<CachedImage | undefined> {
  const cacheKey = `${providerId}:${specHash}`
  const cached = imageCache.get(cacheKey)
  if (cached) {
    if (cached.expiresAt > Date.now()) return cached.value
    imageCache.delete(cacheKey)
  }

  const { db, sandboxImage, and, eq } = await sandboxDb()
  const [image] = await db
    .select({
      status: sandboxImage.status,
      imageRef: sandboxImage.imageRef,
      errorMessage: sandboxImage.errorMessage,
    })
    .from(sandboxImage)
    .where(and(eq(sandboxImage.provider, providerId), eq(sandboxImage.specHash, specHash)))
    .limit(1)

  if (image?.status === 'ready' && image.imageRef) {
    if (imageCache.size >= IMAGE_CACHE_LIMIT) {
      const oldest = imageCache.keys().next()
      if (!oldest.done) imageCache.delete(oldest.value)
    }
    imageCache.set(cacheKey, { expiresAt: Date.now() + IMAGE_TTL_MS, value: image })
  }
  return image
}

/**
 * Re-enqueues a build for a sandbox whose image is unusable.
 *
 * `ensureSandboxImage` otherwise runs only when a sandbox is saved, which left
 * three states permanently stuck until someone re-saved it in Settings: a build
 * that failed, a build whose worker died mid-flight, and — after switching a
 * deployment from a `runtime` provider to a `prebuilt` one — every sandbox
 * created while the old provider was active, since `runtime` writes no image
 * rows at all. Repairing here costs an execution that was going to fail either
 * way and lets the next one succeed, instead of making the user reconfigure a
 * sandbox whose definition was never wrong.
 *
 * Rate-limited, unlike the save path. This fires once per execution, and a bad
 * package name fails in seconds, so re-claiming a failed row on sight would let a
 * per-minute schedule enqueue a per-minute build of something that will never
 * succeed. The cooldown caps that at one attempt per window while a save — an
 * explicit request from a person — still retries immediately. Executions arriving
 * during a healthy build enqueue nothing either way.
 *
 * Imported dynamically for the same reason as {@link sandboxDb} — the registry
 * pulls `@sim/db` into the static import graph, which this module keeps out of
 * the executor bundle. A repair that fails must never replace the caller's
 * message, which is the one naming the sandbox and its build error.
 */
async function scheduleImageRepair(
  spec: { language: SandboxLanguage; dependencies: string[] },
  specHash: string
): Promise<void> {
  try {
    const { ensureSandboxImage, FAILED_BUILD_RETRY_COOLDOWN_MS } = await import(
      '@/lib/execution/remote-sandbox/image-registry'
    )
    await ensureSandboxImage(
      { language: spec.language, dependencies: spec.dependencies },
      specHash,
      { minFailureAgeMs: FAILED_BUILD_RETRY_COOLDOWN_MS }
    )
  } catch (error) {
    logger.warn('Failed to schedule sandbox image repair', { specHash, error })
  }
}

function assertLanguageMatches(sandbox: ResolvedSandbox, language?: CodeLanguage): void {
  if (!language || sandbox.language === language) return
  throw new Error(
    `Sandbox "${sandbox.name}" installs ${sandbox.language} dependencies, but this block runs ${language}. Select a ${language} sandbox or clear the selection.`
  )
}

function describeUnusableImage(
  name: string,
  status: string | undefined,
  errorMessage: string | null | undefined
): string {
  if (status === 'failed') {
    return `Sandbox "${name}" failed to build: ${errorMessage ?? 'installation failed'}. A rebuild has been queued — run again in a moment. If it keeps failing, fix its dependencies in Settings → Sandboxes.`
  }
  if (status === 'pending' || status === 'building') {
    return `Sandbox "${name}" is still building. Wait for it to finish, then run again.`
  }
  return `Sandbox "${name}" has no completed build yet. A build has been queued — run again in a moment.`
}

/**
 * Clears the in-process build cache.
 *
 * Best-effort only, and no longer load-bearing: it clears one process, so on a
 * multi-replica deployment the others keep their entries. Correctness comes from
 * what is NOT cached — the `workspace_sandbox` row is re-read on every resolve,
 * and the cache is keyed by content address, so a stale entry can only ever
 * describe a build that is still exactly what its hash says it is. This just
 * lets the replica that served a mutation pick up a rebuild a little sooner.
 */
export function invalidateSandboxResolution(): void {
  imageCache.clear()
}

function installCommandFor(language: SandboxLanguage): string {
  if (language === CodeLanguage.Python) {
    return `pip install --no-input --disable-pip-version-check -r ${SIM_REQUIREMENTS_PATH}`
  }
  // `--prefix` is the install target; the manifest is copied in as root first,
  // because the filesystem API cannot write into a root-owned directory.
  return `cp ${SIM_PACKAGE_JSON_PATH} ${SIM_DEPS_DIR}/package.json && npm install --prefix ${SIM_DEPS_DIR} --no-audit --no-fund --omit=dev`
}

/**
 * Installs a runtime-strategy sandbox's dependencies before user code runs.
 *
 * The dependency list reaches the sandbox as a file written through the
 * filesystem API, never interpolated into a shell command, so a package name is
 * never parsed as shell syntax. The installer's own output is returned to the
 * caller rather than merged into the execution's stdout, so a package whose name
 * contains the `__SIM_RESULT__` marker cannot corrupt the parsed result.
 *
 * A non-zero exit throws: user code must never run against a half-installed
 * environment and report a confusing `ModuleNotFoundError` instead of the real
 * installation failure.
 */
export async function provisionRuntimeDependencies(
  sandbox: SandboxHandle,
  resolved: ResolvedSandbox,
  options?: { timeoutMs?: number }
): Promise<void> {
  if (resolved.strategy !== 'runtime' || resolved.dependencies.length === 0) return

  const installTimeoutMs = options?.timeoutMs ?? RUNTIME_INSTALL_TIMEOUT_MS
  if (installTimeoutMs <= 0) {
    throw new Error(
      `Sandbox "${resolved.name}" installs its packages at run time, which needs more time than this block's timeout allows. Raise the block's timeout and try again.`
    )
  }

  const manifest = renderDependencyManifest({
    language: resolved.language,
    dependencies: resolved.dependencies,
  })
  const manifestPath =
    resolved.language === CodeLanguage.Python ? SIM_REQUIREMENTS_PATH : SIM_PACKAGE_JSON_PATH

  await sandbox.writeFile(manifestPath, manifest)
  if (resolved.language === CodeLanguage.JavaScript) {
    await sandbox.runCommand(`mkdir -p ${SIM_DEPS_DIR}`, { timeoutMs: 30_000, rootUser: true })
  }

  const started = Date.now()
  const result = await sandbox.runCommand(installCommandFor(resolved.language), {
    timeoutMs: installTimeoutMs,
    rootUser: true,
  })

  if (result.exitCode !== 0) {
    // Daytona merges both streams into stdout, so fall back to it for the real output.
    const output = result.stderr || result.stdout || `installer exited ${result.exitCode}`
    const classified = classifyInstallOutput(resolved.language, output)
    logger.error('Runtime dependency install failed', {
      sandboxId: sandbox.sandboxId,
      sandbox: resolved.name,
      code: classified.code,
      exitCode: result.exitCode,
    })
    throw new Error(`${classified.message}\n\n${tailBuildLog(output)}`)
  }

  logger.info('Installed sandbox dependencies at run time', {
    sandboxId: sandbox.sandboxId,
    sandbox: resolved.name,
    dependencyCount: resolved.dependencies.length,
    durationMs: Date.now() - started,
  })
}
