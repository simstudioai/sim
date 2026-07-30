import { db } from '@sim/db'
import { sandboxImage } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { backoffWithJitter } from '@sim/utils/retry'
import { and, eq, inArray, lt, notInArray, or, type SQL, sql } from 'drizzle-orm'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { runDetached } from '@/lib/core/utils/background'
import {
  buildTimeoutError,
  providerBuildError,
  type SandboxBuildError,
} from '@/lib/execution/remote-sandbox/build-errors'
import { resolveProvider } from '@/lib/execution/remote-sandbox/provider'
import { invalidateSandboxResolution } from '@/lib/execution/remote-sandbox/resolve'
import type { SandboxSpec } from '@/lib/execution/remote-sandbox/sandbox-spec'
import type {
  SandboxImageBuild,
  SandboxImageBuilder,
  SandboxImageStatus,
} from '@/lib/execution/remote-sandbox/types'

const logger = createLogger('SandboxImageRegistry')

/** Ceiling on how long one build may run before it is called failed. */
export const BUILD_POLL_CAP_MS = 15 * 60 * 1000

/** A `building` row older than this is assumed abandoned and may be re-claimed. */
const STALE_BUILD_MS = BUILD_POLL_CAP_MS * 2

const POLL_BASE_MS = 3_000
const POLL_MAX_MS = 20_000

export interface SandboxImageBuildPayload {
  provider: string
  specHash: string
}

/**
 * Collapses concurrent saves of the same spec into one build. Content-addressed,
 * so two workspaces declaring identical dependencies share the key as well as
 * the resulting image.
 */
export function sandboxBuildIdempotencyKey(provider: string, specHash: string): string {
  return `sandbox-image-${provider}-${specHash}`
}

/**
 * How long a failed build is left alone when the caller is an automatic repair
 * rather than a person. Long enough that a per-minute schedule cannot turn a
 * permanently broken package list into a per-minute build, short enough that a
 * transient registry outage recovers within the hour.
 */
export const FAILED_BUILD_RETRY_COOLDOWN_MS = 10 * 60 * 1000

export interface EnsureSandboxImageOptions {
  /**
   * Ignore a `failed` row younger than this instead of re-claiming it.
   *
   * Omitted means retry immediately, which is right for a save: a person editing
   * a package list is explicitly asking for another attempt. Automatic callers
   * pass {@link FAILED_BUILD_RETRY_COOLDOWN_MS} — they fire once per execution,
   * and a build that fails in seconds would otherwise be re-enqueued by every
   * run of a scheduled workflow forever.
   */
  minFailureAgeMs?: number
}

/**
 * Ensures a build exists for `spec`, enqueueing one only when the registry has
 * no row or the last attempt failed. A `ready` or in-flight row is left alone,
 * which is what makes an unchanged save cost nothing.
 *
 * No-ops under a `runtime` provider: it installs per execution and never touches
 * this registry.
 */
export async function ensureSandboxImage(
  spec: SandboxSpec,
  specHash: string,
  options: EnsureSandboxImageOptions = {}
): Promise<void> {
  const provider = resolveProvider()
  if (provider.dependencyStrategy !== 'prebuilt' || !provider.images) return
  // Nothing to install means nothing to build — and `pip install` with no
  // requirement exits non-zero, so a build here would fail permanently.
  if (spec.dependencies.length === 0) return

  const inserted = await db
    .insert(sandboxImage)
    .values({
      id: generateId(),
      provider: provider.id,
      specHash,
      spec,
      status: 'pending',
    })
    .onConflictDoUpdate({
      target: [sandboxImage.provider, sandboxImage.specHash],
      set: {
        status: 'pending',
        errorCode: null,
        errorMessage: null,
        errorDetail: null,
        updatedAt: new Date(),
      },
      // A failed build is retryable, immediately for a person and after a cooldown
      // for an automatic caller. `pending` and `building` become re-claimable once
      // stale: an enqueue that threw (provider outage), a detached run that died
      // with the process, or a worker killed mid-build would otherwise strand the
      // row forever, and no later save could revive it because the content address
      // never changes.
      setWhere: or(
        options.minFailureAgeMs
          ? and(
              eq(sandboxImage.status, 'failed'),
              lt(sandboxImage.updatedAt, new Date(Date.now() - options.minFailureAgeMs))
            )
          : eq(sandboxImage.status, 'failed'),
        and(
          inArray(sandboxImage.status, ['pending', 'building']),
          lt(sandboxImage.updatedAt, new Date(Date.now() - STALE_BUILD_MS))
        )
      ),
    })
    .returning({ id: sandboxImage.id, status: sandboxImage.status })

  // No row returned means the conflict target matched but `setWhere` rejected the
  // update — an existing `ready`, `pending`, or `building` row. Nothing to do.
  if (inserted.length === 0) return

  await enqueueSandboxImageBuild({ provider: provider.id, specHash })
}

async function enqueueSandboxImageBuild(payload: SandboxImageBuildPayload): Promise<void> {
  if (!isTriggerDevEnabled) {
    runDetached('sandbox-image-build', () => runSandboxImageBuild(payload))
    return
  }
  // Dynamically imported so Trigger.dev stays out of the web bundle's static graph.
  const [{ sandboxImageBuildTask }, { tasks }, { resolveTriggerRegion }] = await Promise.all([
    import('@/background/sandbox-image-build'),
    import('@trigger.dev/sdk'),
    import('@/lib/core/async-jobs/region'),
  ])
  await tasks.trigger<typeof sandboxImageBuildTask>('sandbox-image-build', payload, {
    idempotencyKey: sandboxBuildIdempotencyKey(payload.provider, payload.specHash),
    // Short TTL on purpose: the key exists to collapse concurrent saves of the
    // same spec into one build, not to suppress a retry after one failed. The
    // default 30-day window would make a transient failure permanent.
    idempotencyKeyTTL: '5m',
    tags: [`sandboxSpec:${payload.specHash}`],
    region: await resolveTriggerRegion(),
  })
}

async function writeFailure(
  payload: SandboxImageBuildPayload,
  error: SandboxBuildError,
  detail?: string
): Promise<void> {
  await db
    .update(sandboxImage)
    .set({
      status: 'failed',
      errorCode: error.code,
      errorMessage: error.message,
      errorDetail: detail ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(sandboxImage.provider, payload.provider), eq(sandboxImage.specHash, payload.specHash))
    )
  invalidateSandboxResolution()
}

/**
 * Drives one build to a terminal state: claim the row, start the provider build,
 * poll with backoff to {@link BUILD_POLL_CAP_MS}, then write `ready` or `failed`.
 *
 * The claim is conditional on the row still being `pending`, so a re-delivered
 * task (Trigger.dev at-least-once, or a detached retry) is a no-op rather than a
 * second concurrent build.
 */
export async function runSandboxImageBuild(payload: SandboxImageBuildPayload): Promise<void> {
  const provider = resolveProvider()
  if (provider.id !== payload.provider || !provider.images) {
    logger.warn('Skipping sandbox image build for a provider this deployment does not serve', {
      requested: payload.provider,
      active: provider.id,
    })
    return
  }

  const claimed = await db
    .update(sandboxImage)
    .set({ status: 'building', updatedAt: new Date() })
    .where(
      and(
        eq(sandboxImage.provider, payload.provider),
        eq(sandboxImage.specHash, payload.specHash),
        eq(sandboxImage.status, 'pending')
      )
    )
    .returning({ spec: sandboxImage.spec })

  if (claimed.length === 0) {
    logger.info('Sandbox image build already claimed, skipping', { specHash: payload.specHash })
    return
  }
  const spec = claimed[0].spec as SandboxSpec

  let build: SandboxImageBuild
  try {
    build = await provider.images.startBuild(spec, payload.specHash)
  } catch (error) {
    logger.error('Failed to start sandbox image build', toError(error))
    await writeFailure(payload, providerBuildError(getErrorMessage(error)))
    return
  }

  await db
    .update(sandboxImage)
    .set({
      imageRef: build.imageRef,
      buildId: build.buildId,
      providerImageId: build.providerImageId ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(sandboxImage.provider, payload.provider), eq(sandboxImage.specHash, payload.specHash))
    )

  const deadline = Date.now() + BUILD_POLL_CAP_MS
  for (let attempt = 1; Date.now() < deadline; attempt++) {
    await sleep(backoffWithJitter(attempt, null, { baseMs: POLL_BASE_MS, maxMs: POLL_MAX_MS }))
    let status: Awaited<ReturnType<typeof provider.images.getBuildStatus>>
    try {
      status = await provider.images.getBuildStatus(build, spec)
    } catch (error) {
      // A transient poll failure is not a build failure — keep polling until the
      // cap, and let the timeout be the thing that gives up.
      logger.warn('Sandbox image build poll failed', { specHash: payload.specHash, error })
      continue
    }

    if (status.status === 'ready') {
      await db
        .update(sandboxImage)
        .set({
          status: 'ready',
          errorCode: null,
          errorMessage: null,
          errorDetail: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(sandboxImage.provider, payload.provider),
            eq(sandboxImage.specHash, payload.specHash)
          )
        )
      invalidateSandboxResolution()
      logger.info('Sandbox image build ready', {
        specHash: payload.specHash,
        imageRef: build.imageRef,
      })
      return
    }

    if (status.status === 'failed') {
      await writeFailure(payload, status.error ?? providerBuildError(), status.logs ?? undefined)
      logger.warn('Sandbox image build failed', {
        specHash: payload.specHash,
        code: status.error?.code,
      })
      return
    }
  }

  await writeFailure(payload, buildTimeoutError(BUILD_POLL_CAP_MS / 60_000))
  logger.warn('Sandbox image build timed out', { specHash: payload.specHash })
}

/**
 * Deletes the provider image behind a spec hash once no sandbox references it.
 *
 * Called when a sandbox is deleted, and when an edit re-points one at a new
 * content address — both leave the previous build unreferenced. Without it the
 * image sits in provider storage until the retention sweep, which is up to
 * `SANDBOX_IMAGE_RETENTION_DAYS` of paying to store something nothing can select.
 *
 * Builds are keyed by content, not by workspace, so two workspaces declaring the
 * same package list share one image and deleting on the strength of one
 * workspace's action would break the other. The reference check is therefore part
 * of the same statement that removes the row: reading references first and
 * deleting second left a window — wide, because a provider delete is a network
 * call — in which another workspace could adopt the hash, inherit a `ready` row,
 * and have its next run fail against a template already on its way out. Winning
 * the conditional delete is what proves nothing referenced the hash.
 *
 * Claiming the row before the provider call means a provider that then refuses
 * would strand a template nothing points at, so the row is put back and the
 * retention sweep inherits the retry. An in-flight build is left alone rather
 * than raced; the sweep collects it once it settles.
 *
 * Best-effort by contract: failures are logged and swallowed, because this runs
 * after the mutation it follows has already committed and must never turn a
 * successful delete into an error.
 */
export async function releaseSandboxImage(specHash: string): Promise<void> {
  const provider = resolveProvider()
  if (provider.dependencyStrategy !== 'prebuilt' || !provider.images) return

  try {
    const outcome = await claimAndDeleteImage(provider.id, provider.images, specHash)
    if (outcome === 'released') {
      invalidateSandboxResolution()
      logger.info('Released unreferenced sandbox image', { specHash })
    }
  } catch (error) {
    logger.warn('Failed to release sandbox image; the retention sweep will retry', {
      specHash,
      error: getErrorMessage(error),
    })
  }
}

type ImageClaimOutcome = 'released' | 'skipped' | 'failed'

/**
 * Takes ownership of a spec hash's registry row and deletes the image behind it.
 *
 * Both callers that remove an image go through here, because the ordering is the
 * whole contract and having written it twice is what let the two paths drift:
 *
 * 1. The unreferenced check is part of the `DELETE`, not a query before it.
 *    Winning the delete is the proof nothing referenced the hash. Reading first
 *    and deleting second leaves a window — spanning a provider network call —
 *    where another workspace declares the same package list, inherits the `ready`
 *    row without rebuilding, and loses the template underneath it.
 * 2. The provider delete runs only after the claim, so two sweeps or a sweep and
 *    a release cannot both issue it.
 * 3. A provider that refuses gets the row put back, since claiming first would
 *    otherwise strand a template nothing points at and no later pass would find
 *    it. Restoring is what keeps the retry on the sweep.
 *
 * `extraConditions` lets the sweep add its retention cutoff to the same claim
 * rather than trusting the candidate query it ran earlier.
 */
async function claimAndDeleteImage(
  providerId: string,
  images: SandboxImageBuilder,
  specHash: string,
  extraConditions: SQL[] = []
): Promise<ImageClaimOutcome> {
  const [claimed] = await db
    .delete(sandboxImage)
    .where(
      and(
        eq(sandboxImage.provider, providerId),
        eq(sandboxImage.specHash, specHash),
        notInArray(sandboxImage.status, ['pending', 'building']),
        sql`not exists (select 1 from workspace_sandbox ws where ws.spec_hash = ${specHash})`,
        ...extraConditions
      )
    )
    .returning({
      id: sandboxImage.id,
      spec: sandboxImage.spec,
      status: sandboxImage.status,
      imageRef: sandboxImage.imageRef,
      buildId: sandboxImage.buildId,
      providerImageId: sandboxImage.providerImageId,
    })
  if (!claimed) return 'skipped'
  if (!claimed.imageRef) return 'released'

  try {
    await images.deleteImage({
      imageRef: claimed.imageRef,
      buildId: claimed.buildId ?? '',
      providerImageId: claimed.providerImageId ?? undefined,
    })
    return 'released'
  } catch (error) {
    await db
      .insert(sandboxImage)
      .values({
        id: claimed.id,
        provider: providerId,
        specHash,
        spec: claimed.spec,
        status: claimed.status as SandboxImageStatus,
        imageRef: claimed.imageRef,
        buildId: claimed.buildId,
        providerImageId: claimed.providerImageId,
      })
      .onConflictDoNothing()
    logger.warn('Provider refused a sandbox image delete; restored the row for retry', {
      specHash,
      error: getErrorMessage(error),
    })
    return 'failed'
  }
}

/** Most rows one sweep will touch. The next run picks up whatever is left. */
const CLEANUP_BATCH_LIMIT = 200

/** Provider deletes issued at once. Bounded so a sweep cannot stampede the API. */
const CLEANUP_CONCURRENCY = 8

/**
 * Removes build rows that no `workspace_sandbox` still references and that have
 * gone unused past the retention window.
 *
 * The query below only nominates candidates. Every row is re-checked and claimed
 * atomically by {@link claimAndDeleteImage} before its image is touched, because
 * this sweep reads up to {@link CLEANUP_BATCH_LIMIT} rows and then works through
 * them a chunk of network calls at a time — leaving minutes in which a workspace
 * could declare one of those package lists, inherit the `ready` row, and lose the
 * template underneath it. A candidate that stops qualifying in that window simply
 * fails its claim and is skipped.
 *
 * A provider delete that fails restores the row, so the next sweep retries rather
 * than orphaning a remote template nothing points at any more.
 *
 * Progress is committed per chunk. A sweep that is killed part-way — by a route
 * timeout or a redeploy — therefore keeps what it already deleted, instead of
 * re-issuing every provider delete next run and never draining the backlog.
 */
export async function cleanupSandboxImages(retentionDays: number): Promise<{
  deleted: number
  failed: number
}> {
  const provider = resolveProvider()
  if (provider.dependencyStrategy !== 'prebuilt' || !provider.images) {
    return { deleted: 0, failed: 0 }
  }
  const images = provider.images

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  const stale = await db
    .select({
      id: sandboxImage.id,
      specHash: sandboxImage.specHash,
      imageRef: sandboxImage.imageRef,
      buildId: sandboxImage.buildId,
      providerImageId: sandboxImage.providerImageId,
    })
    .from(sandboxImage)
    .where(
      and(
        eq(sandboxImage.provider, provider.id),
        sql`coalesce(${sandboxImage.lastUsedAt}, ${sandboxImage.createdAt}) < ${cutoff}`,
        sql`not exists (select 1 from workspace_sandbox ws where ws.spec_hash = ${sandboxImage.specHash})`
      )
    )
    .limit(CLEANUP_BATCH_LIMIT)

  if (stale.length === CLEANUP_BATCH_LIMIT) {
    logger.info('Sandbox image sweep hit its batch limit; the rest waits for the next run', {
      limit: CLEANUP_BATCH_LIMIT,
    })
  }

  let deleted = 0
  let failed = 0

  for (let offset = 0; offset < stale.length; offset += CLEANUP_CONCURRENCY) {
    const chunk = stale.slice(offset, offset + CLEANUP_CONCURRENCY)
    const outcomes = await Promise.all(
      chunk.map((row) =>
        claimAndDeleteImage(provider.id, images, row.specHash, [
          sql`coalesce(${sandboxImage.lastUsedAt}, ${sandboxImage.createdAt}) < ${cutoff}`,
        ])
      )
    )

    deleted += outcomes.filter((outcome) => outcome === 'released').length
    failed += outcomes.filter((outcome) => outcome === 'failed').length
  }

  if (deleted > 0) invalidateSandboxResolution()
  return { deleted, failed }
}
