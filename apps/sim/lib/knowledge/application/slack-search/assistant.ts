import type {
  OrganizationDelegatedPrincipal,
  SlackInstallationPrincipal,
} from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { resolveOrganizationBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { createRunSegment, updateRunStatus } from '@/lib/copilot/async-runs/repository'
import { buildCopilotRequestPayload } from '@/lib/copilot/chat/payload'
import {
  buildPersistedAssistantMessage,
  normalizeMessage,
  withStoppedContentBlock,
} from '@/lib/copilot/chat/persisted-message'
import { finalizeAssistantTurn } from '@/lib/copilot/chat/terminal-state'
import { prepareCopilotEnvironmentContext } from '@/lib/copilot/environment-context'
import { runHeadlessCopilotLifecycle } from '@/lib/copilot/request/lifecycle/headless'
import {
  acquirePendingChatStream,
  cleanupAbortMarker,
  getChatStreamLockOwners,
  registerActiveStream,
  releasePendingChatStream,
  startAbortPoller,
  unregisterActiveStream,
} from '@/lib/copilot/request/session/abort'
import type { OrchestratorResult } from '@/lib/copilot/request/types'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getSlackSearchSender } from '@/lib/internal/slack/search-client'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { authorizeSlackSearchInstallation } from '@/lib/knowledge/application/slack-search/authorization'
import {
  persistSlackSearchQuestion,
  resolveSlackSearchChat,
  slackSearchChatOperation,
} from '@/lib/knowledge/application/slack-search/chat'
import {
  resolveSlackSearchMember,
  SlackSearchIdentityError,
} from '@/lib/knowledge/application/slack-search/identity'
import { sendSlackSearchOnboarding } from '@/lib/knowledge/application/slack-search/onboarding'
import { recordSlackSearchOutcome } from '@/lib/knowledge/application/slack-search/repository'
import { generateSlackSearchChatTitle } from '@/lib/knowledge/application/slack-search/title'
import {
  requireSlackSearchTurnLease,
  wasSlackSearchTurnStopped,
} from '@/lib/knowledge/application/slack-search/turns'
import { SlackSearchAssistantStream } from '@/lib/slack-search/assistant-stream'
import { deliverSlackSearchConnections } from '@/lib/slack-search/connections'
import {
  SLACK_SEARCH_FAILED_ANSWER,
  SLACK_SEARCH_MAX_DURATION_SECONDS,
} from '@/lib/slack-search/constants'
import { type SlackSearchJob, slackSearchThreadTimestamp } from '@/lib/slack-search/types'
import { projectResolvedSecretDiagnosticContent } from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const logger = createLogger('SlackSearchAssistant')

/** Creates narrowly scoped, short-lived authority for the current verified Slack sender. */
export function slackSearchMemberPrincipal(
  job: SlackSearchJob,
  organizationId: string,
  userId: string
): OrganizationDelegatedPrincipal {
  const issuedAt = new Date()
  return {
    kind: 'organization_delegated',
    serviceId: 'slack-search',
    organizationId,
    subjectUserId: userId,
    delegationId: `${job.installationId}:${job.message.eventId}`,
    audience: 'sim:knowledge',
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + 60_000),
    resourceScope: { installationId: job.installationId, eventId: job.message.eventId },
  }
}

/** Runs the product's organization Assistant with its ordinary tools, chat lock, billing, and persistence. */
export async function runSlackSearchAssistant(
  principal: SlackInstallationPrincipal,
  input: {
    job: SlackSearchJob
    turnId: string
    leaseId: string
    controller: AbortController
  }
) {
  const { job, controller, turnId, leaseId } = input
  const context = await authorizeSlackSearchInstallation(principal, job)
  if (!context) throw new OrchestrationError('forbidden', 'Slack Search is disabled')
  const { installation, secret } = context
  const sender = await getSlackSearchSender(
    secret.botToken,
    job.message.userId,
    installation.teamId,
    controller.signal
  )
  if (!sender) throw new SlackSearchIdentityError()
  let userId: string
  try {
    userId = await resolveSlackSearchMember(
      installation.organizationId,
      installation.teamId,
      job.message.userId,
      sender.email
    )
  } catch (error) {
    if (!(error instanceof SlackSearchIdentityError)) throw error
    await sendSlackSearchOnboarding(principal, {
      job,
      turnId,
      leaseId,
      email: sender.email,
      reason: 'account',
      signal: controller.signal,
    })
    return
  }
  const memberPrincipal = () => slackSearchMemberPrincipal(job, installation.organizationId, userId)
  await authorizeOrganizationOperation(
    memberPrincipal(),
    knowledgeOperations.search.organizationOperation,
    installation
  )
  const chat = await resolveSlackSearchChat(memberPrincipal(), job)
  const messageId = turnId
  if (!(await acquirePendingChatStream(chat.id, messageId)))
    throw new Error('The private conversation is already answering another question')
  registerActiveStream(messageId, controller)
  const abortPoller = startAbortPoller(messageId, controller, { chatId: chat.id })
  let questionPersisted = false
  let titleTask: Promise<void> | undefined
  let runId: string | undefined
  let result: OrchestratorResult | undefined
  let failed = true
  let failure: Error | undefined
  let registry: ResolvedSecretTraceRegistry | undefined
  let stream: SlackSearchAssistantStream | undefined
  let checking = false
  const checkAccess = async (signal: AbortSignal = controller.signal) => {
    signal.throwIfAborted()
    await requireSlackSearchTurnLease(turnId, leaseId)
    if (!(await authorizeSlackSearchInstallation(principal, job)))
      throw new OrchestrationError('forbidden', 'Slack Search is disabled')
    if (
      (await resolveSlackSearchMember(
        installation.organizationId,
        installation.teamId,
        job.message.userId,
        sender.email
      )) !== userId
    )
      throw new SlackSearchIdentityError()
    await authorizeOrganizationOperation(memberPrincipal(), slackSearchChatOperation, installation)
    await authorizeOrganizationOperation(
      memberPrincipal(),
      knowledgeOperations.search.organizationOperation,
      installation
    )
    const owners = await getChatStreamLockOwners([chat.id])
    if (owners.status !== 'verified' || owners.ownersByChatId.get(chat.id) !== messageId)
      throw new Error('Conversation stream ownership was lost')
  }
  const accessPoller = setInterval(() => {
    if (checking || controller.signal.aborted) return
    checking = true
    void checkAccess()
      .catch((error: unknown) => controller.abort(error))
      .finally(() => {
        checking = false
      })
  }, 2000)
  try {
    await checkAccess()
    await persistSlackSearchQuestion(chat.id, userId, messageId, job.message.query)
    questionPersisted = true
    titleTask = generateSlackSearchChatTitle(memberPrincipal(), {
      job,
      signal: controller.signal,
      beforePersist: checkAccess,
    }).catch((error: unknown) => {
      logger.error('Slack chat title generation failed', { chatId: chat.id, error })
    })
    const environmentContext = await prepareCopilotEnvironmentContext(userId, undefined, {
      includeSecrets: false,
    })
    registry = environmentContext.resolvedSecretTraceRegistry
    const executionId = generateId()
    const run = await createRunSegment({
      executionId,
      chatId: chat.id,
      userId,
      streamId: messageId,
      model: chat.model,
      status: 'active',
    })
    if (!run) throw new Error('Could not persist Assistant execution')
    runId = run.id
    const responseStream = new SlackSearchAssistantStream({
      token: secret.botToken,
      channel: job.message.channelId,
      threadTs: slackSearchThreadTimestamp(job.message),
      slackUserId: job.message.userId,
      controller,
      registry: environmentContext.resolvedSecretTraceRegistry,
      beforeDelivery: checkAccess,
      beforeCleanup: checkAccess,
      deliverConnections: (targets) =>
        deliverSlackSearchConnections({
          targets,
          token: secret.botToken,
          organizationId: installation.organizationId,
          userId,
          chatId: chat.id,
          turnId,
          channel: job.message.channelId,
          slackUserId: job.message.userId,
          signal: controller.signal,
          beforeDelivery: checkAccess,
        }),
    })
    stream = responseStream
    const payload = await buildCopilotRequestPayload(
      {
        message: job.message.query,
        userId,
        userMessageId: messageId,
        organizationId: installation.organizationId,
        chatId: chat.id,
        mode: 'assistant',
        model: '',
      },
      { selectedModel: '' }
    )
    const billingAttribution = await resolveOrganizationBillingAttribution({
      actorUserId: userId,
      organizationId: installation.organizationId,
    })
    await responseStream.start()
    result = await runHeadlessCopilotLifecycle(payload, {
      userId,
      organizationId: installation.organizationId,
      chatId: chat.id,
      executionId,
      runId,
      goRoute: '/api/mothership',
      billingAttribution,
      environmentContext,
      resolvedSecretTraceRegistry: environmentContext.resolvedSecretTraceRegistry,
      abortSignal: controller.signal,
      timeout: SLACK_SEARCH_MAX_DURATION_SECONDS * 1000,
      autoExecuteTools: true,
      onEvent: async (event) => {
        try {
          await responseStream.onEvent(event)
        } catch (error) {
          controller.abort(error)
          throw error
        }
      },
    })
    responseStream.assertHealthy()
    controller.signal.throwIfAborted()
    if (!result.success) {
      await responseStream.finishWithError()
      throw new Error('Organization Assistant did not complete')
    }
    await checkAccess()
    await responseStream.finish(result)
    failed = false
    await recordSlackSearchOutcome(installation, 'success')
  } catch (error) {
    failure = toError(error)
    controller.abort(error)
    const failedStream = stream
    const outcomes = await Promise.allSettled([
      ...(failedStream
        ? [
            wasSlackSearchTurnStopped(turnId, leaseId).then((stopped) =>
              stopped ? undefined : failedStream.terminateAfterFailure()
            ),
          ]
        : []),
      recordSlackSearchOutcome(installation, 'assistant_or_delivery_failed'),
      ...(runId ? [updateRunStatus(runId, 'error')] : []),
    ])
    const errors = outcomes.flatMap((outcome) =>
      outcome.status === 'rejected' ? [outcome.reason] : []
    )
    if (errors.length)
      failure = new AggregateError(
        [failure, ...errors],
        'Slack turn cleanup or outcome persistence failed'
      )
  } finally {
    await titleTask
    clearInterval(accessPoller)
    clearInterval(abortPoller)
    try {
      if (questionPersisted) {
        const stopped = failed && (await wasSlackSearchTurnStopped(turnId, leaseId))
        const terminalResult: OrchestratorResult = result ?? {
          success: false,
          content: '',
          contentBlocks: [],
          toolCalls: [],
        }
        const historyResult: OrchestratorResult =
          failed && !stopped
            ? {
                ...terminalResult,
                content: [terminalResult.content, SLACK_SEARCH_FAILED_ANSWER]
                  .filter(Boolean)
                  .join('\n\n'),
                contentBlocks: [
                  ...terminalResult.contentBlocks,
                  { type: 'text', content: SLACK_SEARCH_FAILED_ANSWER, timestamp: Date.now() },
                ],
              }
            : terminalResult
        let message = buildPersistedAssistantMessage(historyResult, messageId, 'assistant')
        if (result) {
          const projection = projectResolvedSecretDiagnosticContent(message, registry)
          if (
            !projection.safe ||
            !isRecordLike(projection.value) ||
            projection.value.role !== 'assistant' ||
            typeof projection.value.id !== 'string' ||
            typeof projection.value.content !== 'string'
          ) {
            failure = new Error('Assistant history could not be safely projected', {
              cause: failure,
            })
            message = buildPersistedAssistantMessage(
              {
                success: false,
                content: 'This Slack turn could not be safely saved.',
                contentBlocks: [],
                toolCalls: [],
              },
              messageId,
              'assistant'
            )
          } else message = normalizeMessage(projection.value)
        }
        const finalized = await finalizeAssistantTurn({
          chatId: chat.id,
          userMessageId: messageId,
          userId,
          assistantMessage: stopped ? withStoppedContentBlock(message) : message,
        })
        if (!finalized.appendedAssistant)
          failure = new Error('Could not persist the Slack Assistant response', { cause: failure })
      }
    } catch (error) {
      failure = failure
        ? new AggregateError([failure, error], 'Slack turn and history persistence failed')
        : toError(error)
    } finally {
      unregisterActiveStream(messageId)
      await releasePendingChatStream(chat.id, messageId)
      await cleanupAbortMarker(messageId)
    }
  }
  if (failure) throw failure
}
