import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { PendingWebhookVerificationTracker } from '@/lib/webhooks/pending-verification'
import {
  cleanupExternalWebhook,
  createExternalWebhookSubscription,
} from '@/lib/webhooks/provider-subscriptions'
import { getProviderHandler } from '@/lib/webhooks/providers'
import type { WebhookProviderHandler } from '@/lib/webhooks/providers/types'
import { fingerprintDesiredWebhookRegistration } from '@/lib/webhooks/registration-identity'
import {
  checkpointWebhookCandidate,
  type DesiredWebhookRegistrationIntent,
  deleteWebhookRegistrationAfterCleanup,
  getWebhookCleanupSnapshotIfCurrent,
  listRetiredWebhookRegistrationsForCleanup,
  type PreparedWebhookCandidate,
  type PreparedWebhookRegistrationWork,
  prepareWebhookRegistrationIntents,
  type WebhookRegistrationOperationFence,
  type WebhookRegistrationRow,
} from '@/lib/webhooks/registration-store'

const logger = createLogger('StableWebhookRegistration')

export interface StableDesiredWebhookRegistration {
  blockId: string
  provider: string
  path: string | null
  routingKey: string | null
  providerConfig: Record<string, unknown>
  desiredConfig: Readonly<Record<string, unknown>>
}

export interface StableWebhookRegistrationDependencies {
  prepareIntents(input: {
    fence: WebhookRegistrationOperationFence
    desired: readonly DesiredWebhookRegistrationIntent[]
  }): Promise<PreparedWebhookRegistrationWork>
  checkpointCandidate: typeof checkpointWebhookCandidate
  listRetired: typeof listRetiredWebhookRegistrationsForCleanup
  getCleanupSnapshot: typeof getWebhookCleanupSnapshotIfCurrent
  deleteAfterCleanup: typeof deleteWebhookRegistrationAfterCleanup
  createExternal: typeof createExternalWebhookSubscription
  cleanupExternal: typeof cleanupExternalWebhook
}

const DEFAULT_DEPENDENCIES: StableWebhookRegistrationDependencies = {
  prepareIntents: prepareWebhookRegistrationIntents,
  checkpointCandidate: checkpointWebhookCandidate,
  listRetired: listRetiredWebhookRegistrationsForCleanup,
  getCleanupSnapshot: getWebhookCleanupSnapshotIfCurrent,
  deleteAfterCleanup: deleteWebhookRegistrationAfterCleanup,
  createExternal: createExternalWebhookSubscription,
  cleanupExternal: cleanupExternalWebhook,
}

export interface PrepareStableWebhookRegistrationsInput {
  request: NextRequest
  fence: WebhookRegistrationOperationFence
  workflow: Record<string, unknown>
  userId: string
  requestId: string
  desired: readonly StableDesiredWebhookRegistration[]
  signal?: AbortSignal
}

function buildDesiredIntents(
  desired: readonly StableDesiredWebhookRegistration[]
): DesiredWebhookRegistrationIntent[] {
  return desired.map((registration) => ({
    blockId: registration.blockId,
    provider: registration.provider,
    path: registration.path,
    routingKey: registration.routingKey,
    providerConfig: registration.providerConfig,
    configFingerprint: fingerprintDesiredWebhookRegistration({
      provider: registration.provider,
      path: registration.path,
      routingKey: registration.routingKey,
      desiredConfig: registration.desiredConfig,
    }),
  }))
}

async function cleanupGenerationFencedRegistration(
  row: WebhookRegistrationRow,
  workflow: Record<string, unknown>,
  requestId: string,
  statuses: readonly ('candidate' | 'orphaned' | 'retired')[],
  dependencies: StableWebhookRegistrationDependencies
): Promise<boolean> {
  if (row.registrationGeneration === null) return false
  const snapshot = await dependencies.getCleanupSnapshot({
    workflowId: row.workflowId,
    webhookId: row.id,
    expectedGeneration: row.registrationGeneration,
    statuses,
  })
  if (!snapshot) return false

  await dependencies.cleanupExternal(snapshot, workflow, requestId, { throwOnError: true })
  return dependencies.deleteAfterCleanup({
    workflowId: snapshot.workflowId,
    webhookId: snapshot.id,
    expectedGeneration: row.registrationGeneration,
    statuses,
  })
}

async function createCandidateProviderState(
  input: PrepareStableWebhookRegistrationsInput,
  candidate: PreparedWebhookCandidate,
  dependencies: StableWebhookRegistrationDependencies
): Promise<Record<string, unknown>> {
  const webhookData = {
    ...candidate.row,
    provider: candidate.desired.provider,
    providerConfig: candidate.row.providerConfig ?? candidate.desired.providerConfig,
  }
  const handler = getProviderHandler(candidate.desired.provider)

  const externalResult = await dependencies.createExternal(
    input.request,
    webhookData,
    input.workflow,
    input.userId,
    input.requestId,
    { signal: input.signal }
  )
  let providerConfig = externalResult.updatedProviderConfig

  if (externalResult.externalSubscriptionCreated) {
    /**
     * Persist the provider-returned state immediately so the external
     * subscription is never unrecorded: if the lease aborts or the process
     * dies between here and the final checkpoint, the retry (or orphan
     * cleanup) can delete this subscription from the row instead of leaking
     * it and creating a duplicate.
     */
    await dependencies.checkpointCandidate({
      fence: input.fence,
      webhookId: candidate.row.id,
      providerConfig,
      prepared: false,
    })
  }

  if (handler.configurePolling) {
    let persistedProviderConfig: Record<string, unknown> | undefined
    const configured = await handler.configurePolling({
      webhook: { ...webhookData, providerConfig },
      requestId: input.requestId,
      persistProviderConfig: async (configuredProviderConfig) => {
        persistedProviderConfig = configuredProviderConfig
        await dependencies.checkpointCandidate({
          fence: input.fence,
          webhookId: candidate.row.id,
          providerConfig: configuredProviderConfig,
          prepared: false,
        })
        return true
      },
    })
    if (!configured) {
      throw new Error(`Failed to configure ${candidate.desired.provider} polling`)
    }
    if (persistedProviderConfig) {
      providerConfig = persistedProviderConfig
    } else {
      const configuredRow = await dependencies.getCleanupSnapshot({
        workflowId: input.fence.workflowId,
        webhookId: candidate.row.id,
        expectedGeneration: input.fence.generation,
        statuses: ['candidate'],
      })
      if (!configuredRow) {
        throw new Error('Webhook candidate became stale while configuring polling')
      }
      if (configuredRow.providerConfig && typeof configuredRow.providerConfig === 'object') {
        providerConfig = configuredRow.providerConfig as Record<string, unknown>
      }
    }
  }

  return providerConfig
}

/**
 * Prepares one candidate registration without ever touching the currently
 * serving external subscription: the candidate's subscription is created
 * alongside the live one, and the old subscription is deleted only after
 * activation retires its row (cleanupRetiredWebhookRegistrationsAfterActivation).
 * A failed or superseded attempt therefore leaves live delivery intact — the
 * candidate's own external state is rolled back or garbage-collected as an
 * orphan on the next preparation.
 *
 * Providers with singleton registrations per credential (e.g. Telegram
 * setWebhook) implicitly repoint on create; their delete handlers already
 * skip teardown while an active deployment uses the same credential, so the
 * retired-row cleanup after cutover cannot disturb the new subscription.
 */
async function prepareCandidate(
  input: PrepareStableWebhookRegistrationsInput,
  candidate: PreparedWebhookCandidate,
  dependencies: StableWebhookRegistrationDependencies
): Promise<void> {
  if (candidate.row.preparedAt) return
  input.signal?.throwIfAborted()

  const handler: WebhookProviderHandler = getProviderHandler(candidate.desired.provider)
  const hasProviderPreparation = Boolean(handler.createSubscription || handler.configurePolling)

  if (!hasProviderPreparation) {
    await dependencies.checkpointCandidate({
      fence: input.fence,
      webhookId: candidate.row.id,
      providerConfig: candidate.desired.providerConfig,
    })
    return
  }

  const verificationTracker = new PendingWebhookVerificationTracker()
  let preparedProviderConfig: Record<string, unknown> | undefined
  try {
    if (candidate.row.path) {
      await verificationTracker.register({
        path: candidate.row.path,
        provider: candidate.desired.provider,
        workflowId: input.fence.workflowId,
        blockId: candidate.desired.blockId,
        metadata: candidate.desired.providerConfig,
      })
    }

    input.signal?.throwIfAborted()
    preparedProviderConfig = await createCandidateProviderState(input, candidate, dependencies)
    input.signal?.throwIfAborted()
    await dependencies.checkpointCandidate({
      fence: input.fence,
      webhookId: candidate.row.id,
      providerConfig: preparedProviderConfig,
    })
  } catch (error) {
    if (preparedProviderConfig) {
      try {
        const currentCandidate = await dependencies.getCleanupSnapshot({
          workflowId: input.fence.workflowId,
          webhookId: candidate.row.id,
          expectedGeneration: input.fence.generation,
          statuses: ['candidate'],
        })
        if (currentCandidate) {
          await dependencies.cleanupExternal(
            { ...currentCandidate, providerConfig: preparedProviderConfig },
            input.workflow,
            input.requestId,
            { throwOnError: true }
          )
        }
      } catch (cleanupError) {
        logger.error('Failed to rollback an uncheckpointed webhook candidate', {
          workflowId: input.fence.workflowId,
          webhookId: candidate.row.id,
          error: toError(cleanupError).message,
        })
      }
    }
    throw error
  } finally {
    await verificationTracker.clearAll()
  }
}

/**
 * Prepares each registration action independently while leaving the currently active set untouched.
 */
export async function prepareStableWebhookRegistrations(
  input: PrepareStableWebhookRegistrationsInput,
  dependencies: StableWebhookRegistrationDependencies = DEFAULT_DEPENDENCIES
): Promise<void> {
  input.signal?.throwIfAborted()
  const work = await dependencies.prepareIntents({
    fence: input.fence,
    desired: buildDesiredIntents(input.desired),
  })

  const failures: Error[] = []
  const blocksWithFailedOrphanCleanup = new Set<string>()
  for (const orphaned of work.orphanedCandidates) {
    try {
      await cleanupGenerationFencedRegistration(
        orphaned,
        input.workflow,
        input.requestId,
        ['orphaned'],
        dependencies
      )
    } catch (error) {
      failures.push(toError(error))
      if (orphaned.blockId) blocksWithFailedOrphanCleanup.add(orphaned.blockId)
    }
  }

  for (const candidate of work.candidates) {
    if (blocksWithFailedOrphanCleanup.has(candidate.desired.blockId)) continue
    try {
      await prepareCandidate(input, candidate, dependencies)
    } catch (error) {
      failures.push(toError(error))
      logger.warn('Webhook registration candidate preparation failed', {
        workflowId: input.fence.workflowId,
        webhookId: candidate.row.id,
        provider: candidate.desired.provider,
        error: toError(error).message,
      })
    }
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Failed to prepare ${failures.length} webhook registration(s)`
    )
  }
}

/**
 * Cleans retired provider resources after activation without trusting stale cleanup payloads.
 */
export async function cleanupRetiredWebhookRegistrationsAfterActivation(
  input: {
    fence: WebhookRegistrationOperationFence
    workflow: Record<string, unknown>
    requestId: string
    signal?: AbortSignal
  },
  dependencies: StableWebhookRegistrationDependencies = DEFAULT_DEPENDENCIES
): Promise<void> {
  while (true) {
    input.signal?.throwIfAborted()
    const retiredRows = await dependencies.listRetired({ ...input.fence, limit: 100 })
    if (retiredRows.length === 0) return

    const failures: Error[] = []
    for (const row of retiredRows) {
      input.signal?.throwIfAborted()
      try {
        await cleanupGenerationFencedRegistration(
          row,
          input.workflow,
          input.requestId,
          ['retired'],
          dependencies
        )
      } catch (error) {
        failures.push(toError(error))
      }
    }

    if (failures.length > 0) {
      throw new AggregateError(failures, `Failed to clean ${failures.length} retired webhook(s)`)
    }
  }
}
