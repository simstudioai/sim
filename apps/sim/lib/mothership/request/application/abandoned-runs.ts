import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { NoWorkspaceAccessError } from '@/lib/core/application'
import { env } from '@/lib/core/config/env'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import {
  findAbandonedRecoverableRuns,
  settleRunWithoutAccess,
  type UnownedRun,
} from '@/lib/mothership/async-runs/orphaned-runs'
import {
  createTrustedCopilotPrincipal,
  createTrustedOrganizationCopilotPrincipal,
} from '@/lib/mothership/auth/application-delegation'
import {
  RUN_TAKEOVER_AUDIENCE,
  takeOverStreamRun,
} from '@/lib/mothership/request/application/recover-stream'
import { requestExplicitStreamAbort } from '@/lib/mothership/request/session/explicit-abort'

const logger = createLogger('MothershipAbandonedRuns')

/** A dead controller's chat lock lapses within a minute; this finds its run soon after. */
const TAKEOVER_INTERVAL_MS = 20_000
const TAKEOVER_BATCH_SIZE = 20
const DELEGATION_TTL_MS = 60_000

let timer: ReturnType<typeof setInterval> | undefined
let running = false
/** Aborted on shutdown; a takeover checks it at its commit point, the controller claim. */
const shutdown = new AbortController()

/**
 * Resumes the run as its user. Only an access denial settles the run as an error and stops
 * the worker: the authorization refusing the user or chat, or recovery finding the user's
 * workspace access gone since. Any other refusal leaves it recoverable, as a failed reconnect
 * does.
 */
async function takeOver(run: UnownedRun): Promise<void> {
  const delegationId = `takeover:${run.id}`
  const delegation = { audience: RUN_TAKEOVER_AUDIENCE, ttlMs: DELEGATION_TTL_MS }
  const { userId, chatId, workspaceId, organizationId } = run
  const principal = organizationId
    ? createTrustedOrganizationCopilotPrincipal(
        { userId, organizationId, chatId, delegationId },
        delegation
      )
    : workspaceId
      ? createTrustedCopilotPrincipal({ userId, workspaceId, chatId, delegationId }, delegation)
      : null
  if (!principal) return
  const input = { streamId: run.streamId }
  try {
    await takeOverStreamRun.authorize({ principal, input })
  } catch (error) {
    const refusal = asOrchestrationError(error)?.code
    if (refusal !== 'forbidden' && refusal !== 'not_found') throw error
    await settleWithoutAccess(run)
    return
  }
  try {
    await takeOverStreamRun.execute({
      principal,
      input,
      request: { headers: new Headers(), signal: shutdown.signal },
    })
  } catch (error) {
    if (!(asOrchestrationError(error) instanceof NoWorkspaceAccessError)) throw error
    await settleWithoutAccess(run)
  }
}

async function settleWithoutAccess(run: UnownedRun): Promise<void> {
  if (!(await settleRunWithoutAccess(run))) return
  logger.info('Settled an abandoned run its user may no longer continue', {
    runId: run.id,
    streamId: run.streamId,
  })
  await requestExplicitStreamAbort({
    streamId: run.streamId,
    userId: run.userId,
    chatId: run.chatId,
  }).catch((error) =>
    logger.warn('Worker stop for a settled abandoned run was not delivered', {
      streamId: run.streamId,
      error: getErrorMessage(error),
    })
  )
}

/**
 * Takes over each interactive run whose controller is gone, as a browser reconnect would,
 * so a run outlives the Sim process driving it (a deploy or a crash) with no browser open.
 * Every Sim process looks; the chat lock and the controller token admit exactly one.
 */
export async function takeOverAbandonedRuns(): Promise<void> {
  if (running) return
  running = true
  try {
    if (await isFeatureEnabled('mothership-abandoned-run-takeover-disabled')) return
    for (const run of await findAbandonedRecoverableRuns(TAKEOVER_BATCH_SIZE)) {
      if (shutdown.signal.aborted) return
      await takeOver(run).catch((error) =>
        logger.warn('Abandoned run could not be taken over; a later round retries', {
          runId: run.id,
          streamId: run.streamId,
          error: getErrorMessage(error),
        })
      )
    }
  } finally {
    running = false
  }
}

/**
 * Needs Redis, whose chat locks are the only proof a run is abandoned. Stops on shutdown, so a
 * draining process adopts no run it is about to abandon.
 */
export function startAbandonedRunTakeover(): void {
  if (!env.COPILOT_API_KEY || !env.REDIS_URL || timer) return
  timer = setInterval(() => {
    void takeOverAbandonedRuns().catch((error) =>
      logger.warn('Abandoned run scan failed', { error: getErrorMessage(error) })
    )
  }, TAKEOVER_INTERVAL_MS)
  timer.unref()
  process.once('SIGTERM', stopAbandonedRunTakeover)
  process.once('SIGINT', stopAbandonedRunTakeover)
}

/** Ends the scans and refuses every takeover not yet committed, including one in flight. */
function stopAbandonedRunTakeover(): void {
  clearInterval(timer)
  shutdown.abort()
}
