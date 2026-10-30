import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createLogger } from '@sim/logger'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId, generateShortId } from '@sim/utils/id'
import { toArray, toRecord } from '@sim/utils/object'
import { makeSignature } from 'better-auth/crypto'
import postgres from 'postgres'
import {
  listAssistantActionReceiptsContract,
  listAssistantActionsContract,
  readAssistantToolPermissionsContract,
} from '@/lib/api/contracts/assistant-actions'
import { getOrganizationAccountsContract } from '@/lib/api/contracts/organization-accounts'
import { closeRedisConnection } from '@/lib/core/config/redis'
import {
  acquirePendingChatStream,
  releasePendingChatStream,
  startAbortPoller,
} from '@/lib/mothership/request/session/abort'
import { allocateCursor, appendEvents, clearBuffer } from '@/lib/mothership/request/session/buffer'
import type { SessionStreamEvent } from '@/lib/mothership/request/session/contract'
import { createEvent } from '@/lib/mothership/request/session/event'

/**
 * Runs against a local app and disposable PostgreSQL with member Search, Connected Accounts, and Access Control enabled.
 * Requires ASSISTANT_ACTIONS_E2E_BASE_URL, ASSISTANT_ACTIONS_E2E_DATABASE_URL,
 * ASSISTANT_ACTIONS_E2E_AUTH_SECRET, ASSISTANT_ACTIONS_E2E_REPORT_PATH, and the app's REDIS_URL.
 * Verifies account policy persistence and action review over real HTTP without executing provider operations.
 */
const logger = createLogger('AssistantActionsE2E')
function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

const baseUrl = new URL(requiredEnvironment('ASSISTANT_ACTIONS_E2E_BASE_URL'))
assert(['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname), 'Use a local app')
assert.equal(baseUrl.protocol, 'http:')
assert.equal(baseUrl.pathname, '/')
assert(!baseUrl.username && !baseUrl.password, 'The app URL must not contain credentials')
const databaseUrl = assertDisposableTestDatabaseUrl(
  requiredEnvironment('ASSISTANT_ACTIONS_E2E_DATABASE_URL')
)
const redisUrl = new URL(requiredEnvironment('REDIS_URL'))
assert(['redis:', 'rediss:'].includes(redisUrl.protocol), 'Use a Redis URL')
assert(['localhost', '127.0.0.1', '[::1]'].includes(redisUrl.hostname), 'Use local Redis')
assert(!redisUrl.username && !redisUrl.password && !redisUrl.search, 'Use credential-free Redis')
const authSecret = requiredEnvironment('ASSISTANT_ACTIONS_E2E_AUTH_SECRET')
assert(authSecret.length >= 32, 'Use a local auth secret of at least 32 characters')
const reportPath = resolve(requiredEnvironment('ASSISTANT_ACTIONS_E2E_REPORT_PATH'))
const artifactDirectory = `${reportPath}.artifacts`
const sql = postgres(databaseUrl.toString(), { max: 2 })
const userId = generateId()
const organizationId = generateId()
const otherOrganizationId = generateId()
const assistantId = generateId()
const credentialId = generateId()
const secondCredentialId = generateId()
const codaServerId = generateId()
const firefliesServerId = generateId()
const firefliesCredentialId = `mcp-cg-${generateId()}`
const nativeCredentialId = generateId()
const groupId = generateId()
const enrollmentId = generateId()
const runId = generateId()
const streamId = generateId()
const previousRunId = generateId()
const previousStreamId = generateId()
const previousCallId = generateId()
const lagChatId = generateId()
const lagRunId = generateId()
const lagStreamId = generateId()
const lagFirstCallId = generateId()
const lagSecondCallId = generateId()
const lateCallId = generateId()
const bulkChatId = generateId()
const bulkStreamId = generateId()
const bulkRunId = generateId()
const reviewChatId = generateId()
const reviewRunId = generateId()
const reviewStreamId = generateId()
const keyboardCallId = generateId()
const otherFocusCallId = generateId()
const navigationCallId = generateId()
const selectiveCallId = generateId()
const batchFirstCallId = generateId()
const batchSecondCallId = generateId()
const batchLateCallId = generateId()
const requestId = generateId()
const firstCallId = generateId()
const secondCallId = generateId()
const fixtureStreams = [
  { chatId: bulkChatId, streamId: bulkStreamId },
  { chatId: assistantId, streamId },
  { chatId: lagChatId, streamId: lagStreamId },
  { chatId: reviewChatId, streamId: reviewStreamId },
]
const streamPollers: ReturnType<typeof setInterval>[] = []
const catalogAccounts = [
  { option: 'gmail', provider: 'google-email', name: 'Gmail', supported: true },
  {
    option: 'google-calendar',
    provider: 'google-calendar',
    name: 'Google Calendar',
    supported: true,
  },
  { option: 'google-drive', provider: 'google-drive', name: 'Google Drive', supported: true },
  { option: 'confluence', provider: 'confluence', name: 'Confluence', supported: true },
  {
    option: 'github-repositories',
    provider: 'github-repositories',
    name: 'GitHub',
    supported: true,
  },
  { option: 'google-docs', provider: 'google-docs', name: 'Google Docs', supported: true },
  { option: 'google-sheets', provider: 'google-sheets', name: 'Google Sheets', supported: true },
  { option: 'google-meet', provider: 'google-meet', name: 'Google Meet', supported: false },
].map((account) => ({ ...account, credentialId: generateId() }))
const token = generateShortId()
const root = `/o/${organizationId}`
const question = 'Create the two launch follow-up tickets in Jira.'
const answer = 'Review the two Jira issues before I create them.'
const reviewAnswer = 'Review these keyboard and batch proposals.'
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const browserMessages: { type: string; text: string }[] = []
const browserErrors: string[] = []
const serverErrors: { path: string; status: number }[] = []
const httpResponses: { method: string; path: string; status: number }[] = []
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const reviewCards = page.getByRole('region', { name: 'Review Create Jira issue', exact: true })
page.on('console', (message) => {
  if (browserMessages.length < 40)
    browserMessages.push({ type: message.type(), text: message.text().slice(0, 1000) })
})
page.on('pageerror', (error) => browserErrors.push(error.message))
page.on('response', (response) => {
  const url = new URL(response.url())
  if (url.origin === baseUrl.origin && url.pathname.startsWith('/api/'))
    httpResponses.push({
      method: response.request().method(),
      path: url.pathname,
      status: response.status(),
    })
  if (url.origin === baseUrl.origin && response.status() >= 500)
    serverErrors.push({ path: url.pathname, status: response.status() })
})

async function check(name: string, run: () => Promise<void>) {
  const started = performance.now()
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) })
    logger.info(`PASS ${name}`)
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      error: getErrorMessage(error),
    })
    throw error
  }
}

async function capture(name: string) {
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({ content: 'nextjs-portal { display: none; }' })
  await page
    .getByRole('dialog')
    .evaluateAll((dialogs) =>
      Promise.all(
        dialogs.flatMap((dialog) =>
          dialog
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished.catch(() => undefined))
        )
      )
    )
  await page.screenshot({ path: resolve(artifactDirectory, `${name}.png`), animations: 'disabled' })
}

function proposalArguments(summary: string) {
  return {
    credential: credentialId,
    domain: 'acme.atlassian.net',
    projectId: 'LAUNCH',
    issueType: 'Task',
    summary,
    description: 'Confirm the final owner and target date before the customer announcement.',
  }
}

async function insertProposal(targetRunId: string, toolCallId: string, summary: string) {
  await sql`insert into copilot_async_tool_calls (run_id, tool_call_id, tool_name, executable_name, args, assistant_action, execution_retryable, permission_requested_at)
    values (${targetRunId}, ${toolCallId}, 'jira_write', 'jira_write', ${sql.json(proposalArguments(summary))}, ${sql.json({ credentialId, operationVersion: 1, effect: 'write' })}, false, now())`
}

async function appendStreamEvents(
  chatId: string,
  targetStreamId: string,
  events: SessionStreamEvent[]
) {
  for (const event of events) {
    const position = await allocateCursor(targetStreamId)
    const result = await appendEvents(
      [createEvent({ ...event, ...position, streamId: targetStreamId, chatId, requestId })],
      { streamId: targetStreamId, userId }
    )
    assert.equal(result.persisted, true, 'Fixture stream exceeded its replay budget')
  }
}

function pendingToolEvent(toolCallId: string, summary: string): SessionStreamEvent {
  return {
    type: 'tool',
    payload: {
      phase: 'call',
      executor: 'sim',
      mode: 'async',
      toolCallId,
      toolName: 'jira_write',
      status: 'awaiting_approval',
      arguments: proposalArguments(summary),
    },
  }
}

try {
  await mkdir(artifactDirectory, { recursive: true })
  await sql.begin(async (tx) => {
    const email = `${userId}@assistant-actions-e2e.test`
    await tx`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
      values (${userId}, 'Taylor', ${email}, ${email}, true, now(), now())`
    await tx`insert into user_stats (id, user_id) values (${generateId()}, ${userId})`
    await tx`insert into organization (id, name, slug, created_at)
      values (${organizationId}, 'Acme', ${organizationId}, now()), (${otherOrganizationId}, 'Other organization', ${otherOrganizationId}, now())`
    await tx`insert into member (id, user_id, organization_id, role)
      values (${generateId()}, ${userId}, ${organizationId}, 'owner')`
    await tx`insert into session (id, token, user_id, expires_at, created_at, updated_at)
      values (${generateId()}, ${token}, ${userId}, now() + interval '1 day', now(), now())`
    await tx`insert into credential_group (id, organization_id, public_id, name, options)
      values (${groupId}, ${organizationId}, ${generateId()}, 'Personal Jira', ${tx.json([{ id: 'jira', provider: 'jira' }, { id: 'jira-team', provider: 'jira' }, { id: 'salesforce', provider: 'salesforce' }, ...catalogAccounts.map((account) => ({ id: account.option, provider: account.option }))].map(({ id, provider }) => ({ id, provider, label: id, authorizationAppId: 'fixture', requiredScopes: [], scopeVersion: 1, required: false, status: 'active' })))})`
    await tx`insert into resource_policy (id, organization_id, resource_type, resource_id, document, created_by, updated_by)
      values (${generateId()}, ${organizationId}, 'credential_group', ${groupId}, ${tx.json({ version: 2, resource: { type: 'credential_group', id: groupId }, statements: [] })}, ${userId}, ${userId})`
    await tx`insert into credential_group_enrollment (id, credential_group_id, user_id, email, status, invitation_token_hash, invitation_expires_at, invited_at)
      values (${enrollmentId}, ${groupId}, ${userId}, ${email}, 'completed', ${enrollmentId.replaceAll('-', '').repeat(2)}, now() + interval '1 day', now())`
    for (const [id, provider] of [
      [codaServerId, 'coda'],
      [firefliesServerId, 'fireflies'],
    ] as const) {
      await tx`insert into mcp_servers (id, organization_id, credential_group_id, managed_connector_id, name, transport, auth_type, url)
        values (${id}, ${organizationId}, ${groupId}, ${provider}, ${provider}, 'streamable-http', 'oauth', 'https://example.invalid/mcp')`
    }
    await tx`insert into credential (id, organization_id, type, display_name, credential_group_enrollment_id, mcp_server_id, managed_oauth_status, encrypted_oauth_token_set, mcp_tools, granted_at)
      values (${firefliesCredentialId}, ${organizationId}, 'managed_mcp', 'meetings@acme.example', ${enrollmentId}, ${firefliesServerId}, 'active', 'fixture-not-a-provider-token', '[]'::jsonb, now())`
    for (const source of [
      'coda',
      'jira',
      'gmail',
      'google_calendar',
      'google_drive',
      'confluence',
      'github',
      'google_meet',
    ]) {
      await tx`insert into organization_search_integration (organization_id, connector_type, approved)
        values (${organizationId}, ${source}, true)`
    }
    await tx`insert into credential (id, organization_id, type, created_by, display_name, provider_id, credential_group_enrollment_id, credential_group_option_id, managed_oauth_status, managed_oauth_scope_version, granted_scopes, provider_subject_id, authorization_app_id, encrypted_oauth_token_set, granted_at)
      values (${credentialId}, ${organizationId}, 'managed_oauth', ${userId}, 'taylor@acme.example', 'jira', ${enrollmentId}, 'jira', 'active', 1, '{}'::text[], ${userId}, 'fixture', 'fixture-not-a-provider-token', now())`
    await tx`insert into credential (id, organization_id, type, created_by, display_name, provider_id, credential_group_enrollment_id, credential_group_option_id, managed_oauth_status, managed_oauth_scope_version, granted_scopes, provider_subject_id, authorization_app_id, encrypted_oauth_token_set, granted_at)
      values (${secondCredentialId}, ${organizationId}, 'managed_oauth', ${userId}, 'launch-team@acme.example', 'jira', ${enrollmentId}, 'jira-team', 'active', 1, '{}'::text[], ${secondCredentialId}, 'fixture', 'fixture-not-a-provider-token', now())`
    await tx`insert into credential (id, organization_id, type, created_by, display_name, provider_id, credential_group_enrollment_id, credential_group_option_id, managed_oauth_status, managed_oauth_scope_version, granted_scopes, provider_subject_id, authorization_app_id, encrypted_oauth_token_set, granted_at)
      values (${nativeCredentialId}, ${organizationId}, 'managed_oauth', ${userId}, 'taylor@acme.example', 'salesforce', ${enrollmentId}, 'salesforce', 'active', 1, '{}'::text[], ${userId}, 'fixture', 'fixture-not-a-provider-token', now())`
    for (const account of catalogAccounts) {
      await tx`insert into credential (id, organization_id, type, created_by, display_name, provider_id, credential_group_enrollment_id, credential_group_option_id, managed_oauth_status, managed_oauth_scope_version, granted_scopes, provider_subject_id, authorization_app_id, encrypted_oauth_token_set, granted_at)
        values (${account.credentialId}, ${organizationId}, 'managed_oauth', ${userId}, 'taylor@acme.example', ${account.provider}, ${enrollmentId}, ${account.option}, 'active', 1, '{}'::text[], ${userId}, 'fixture', 'fixture-not-a-provider-token', now())`
    }
    await tx`insert into copilot_chats (id, user_id, organization_id, type, title, conversation_id, config)
      values (${bulkChatId}, ${userId}, ${organizationId}, 'mothership', 'Paginated action review', ${bulkStreamId}, ${tx.json({ conversationMode: 'assistant' })}),
      (${assistantId}, ${userId}, ${organizationId}, 'mothership', 'Launch follow-up', ${streamId}, ${tx.json({ conversationMode: 'assistant' })}),
      (${lagChatId}, ${userId}, ${organizationId}, 'mothership', 'Delayed action transcript', ${lagStreamId}, ${tx.json({ conversationMode: 'assistant' })}),
      (${reviewChatId}, ${userId}, ${organizationId}, 'mothership', 'Keyboard and batch review', ${reviewStreamId}, ${tx.json({ conversationMode: 'assistant' })})`
    const oldResponseId = generateId()
    for (const message of [
      {
        id: previousStreamId,
        role: 'user',
        content: 'Prepare an earlier Jira issue.',
        stream: previousStreamId,
      },
      {
        id: oldResponseId,
        role: 'assistant',
        content: 'This earlier request has ended.',
        stream: previousStreamId,
        contentBlocks: [
          { type: 'text', content: 'This earlier request has ended.' },
          {
            type: 'tool',
            phase: 'call',
            toolCall: {
              id: previousCallId,
              name: 'jira_write',
              state: 'awaiting_approval',
              display: { title: 'Earlier Jira proposal' },
              params: proposalArguments('An old request that must not gain new actions'),
            },
          },
        ],
      },
      { id: streamId, role: 'user', content: question, stream: streamId },
    ].entries()) {
      const [index, data] = message
      const { stream, ...content } = data
      await tx`insert into copilot_messages (id, chat_id, message_id, role, stream_id, content, seq)
        values (${generateId()}, ${assistantId}, ${data.id}, ${data.role}, ${stream}, ${tx.json({ ...content, requestId, timestamp: new Date().toISOString() })}, ${index + 1})`
    }
    await tx`insert into copilot_messages (id, chat_id, message_id, role, stream_id, content, seq)
      values (${generateId()}, ${bulkChatId}, ${bulkStreamId}, 'user', ${bulkStreamId}, ${tx.json({ id: bulkStreamId, role: 'user', content: 'Review this batch of Jira issues.', requestId, timestamp: new Date().toISOString() })}, 1),
      (${generateId()}, ${lagChatId}, ${lagStreamId}, 'user', ${lagStreamId}, ${tx.json({ id: lagStreamId, role: 'user', content: 'Create two more Jira issues.', requestId, timestamp: new Date().toISOString() })}, 1),
      (${generateId()}, ${reviewChatId}, ${reviewStreamId}, 'user', ${reviewStreamId}, ${tx.json({ id: reviewStreamId, role: 'user', content: 'Prepare follow-up actions for review.', requestId, timestamp: new Date().toISOString() })}, 1)`
    await tx`insert into copilot_runs (id, chat_id, user_id, organization_id, execution_id, stream_id, tool_execution_version, status, started_at, completed_at, tool_admission_closed_at)
      values (${previousRunId}, ${assistantId}, ${userId}, ${organizationId}, ${generateId()}, ${previousStreamId}, 3, 'complete', now() - interval '1 hour', now() - interval '59 minutes', now() - interval '59 minutes')`
    await tx`insert into copilot_runs (id, chat_id, user_id, organization_id, execution_id, stream_id, tool_execution_version, status)
      values (${bulkRunId}, ${bulkChatId}, ${userId}, ${organizationId}, ${generateId()}, ${bulkStreamId}, 3, 'paused_waiting_for_tool'),
      (${runId}, ${assistantId}, ${userId}, ${organizationId}, ${generateId()}, ${streamId}, 3, 'paused_waiting_for_tool'),
      (${lagRunId}, ${lagChatId}, ${userId}, ${organizationId}, ${generateId()}, ${lagStreamId}, 3, 'paused_waiting_for_tool'),
      (${reviewRunId}, ${reviewChatId}, ${userId}, ${organizationId}, ${generateId()}, ${reviewStreamId}, 3, 'paused_waiting_for_tool')`
  })
  await insertProposal(runId, firstCallId, 'Publish the launch checklist')
  await insertProposal(runId, secondCallId, 'Confirm the rollout owners')
  for (const stream of fixtureStreams) {
    assert(await acquirePendingChatStream(stream.chatId, stream.streamId, 0))
    streamPollers.push(
      startAbortPoller(stream.streamId, new AbortController(), { chatId: stream.chatId })
    )
  }
  await appendStreamEvents(assistantId, streamId, [
    { type: 'session', payload: { kind: 'start' } },
    { type: 'text', payload: { channel: 'assistant', text: answer } },
    pendingToolEvent(firstCallId, 'Publish the launch checklist'),
    pendingToolEvent(secondCallId, 'Confirm the rollout owners'),
  ])
  await appendStreamEvents(lagChatId, lagStreamId, [
    { type: 'session', payload: { kind: 'start' } },
    {
      type: 'text',
      payload: { channel: 'assistant', text: 'I have prepared two more issues for review.' },
    },
  ])
  await appendStreamEvents(reviewChatId, reviewStreamId, [
    { type: 'session', payload: { kind: 'start' } },
    { type: 'text', payload: { channel: 'assistant', text: reviewAnswer } },
  ])
  await context.addCookies([
    {
      name: 'better-auth.session_token',
      value: encodeURIComponent(`${token}.${await makeSignature(token, authSecret)}`),
      url: baseUrl.origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
  await check(
    'Receipts restore actions before the transcript arrives and conceal foreign turns',
    async () => {
      const url = `${baseUrl.origin}/api/organizations/${organizationId}/chats/${assistantId}/actions/receipts`
      const response = await context.request.get(url, { params: { streamId } })
      assert.equal(response.status(), 200, await response.text())
      const result = listAssistantActionReceiptsContract.response.schema.parse(
        await response.json()
      )
      assert.deepEqual(
        result.receipts.map((receipt) => receipt.toolCallId),
        [firstCallId, secondCallId]
      )
      assert(result.receipts.every((receipt) => receipt.state === 'pending'))
      assert(
        result.receipts.every((receipt) =>
          receipt.fields.every((field) => field.name !== 'credential')
        )
      )
      const foreign = await context.request.get(url, { params: { streamId: lagStreamId } })
      assert.equal(foreign.status(), 200)
      assert.deepEqual(
        listAssistantActionReceiptsContract.response.schema.parse(await foreign.json()).receipts,
        []
      )
      const overflow = new URL(url)
      for (let i = 0; i < 33; i++) overflow.searchParams.append('toolCallIds', `call-${i}`)
      assert.equal((await context.request.get(overflow.toString())).status(), 400)
    }
  )
  await check(
    'Historical receipts distinguish approval, completion, cancellation, and uncertain outcomes',
    async () => {
      await insertProposal(previousRunId, previousCallId, 'Original historical title')
      await sql`update copilot_async_tool_calls set status = 'completed', permission_decision = 'allow', permission_decided_at = now(), approved_args = ${sql.json(proposalArguments('Approved historical title'))}, execution_started_at = now(), execution_settled_at = now(), completed_at = now(), result = ${sql.json({ output: { warning: 'Issue created; assignment needs attention. Do not recreate the issue.', privatePayload: 'not-for-the-receipt'.repeat(20_000) } })} where tool_call_id = ${previousCallId}`
      const url = `${baseUrl.origin}/api/organizations/${organizationId}/chats/${assistantId}/actions/receipts`
      const response = await context.request.get(url, { params: { toolCallIds: previousCallId } })
      assert.equal(response.status(), 200, await response.text())
      const result = listAssistantActionReceiptsContract.response.schema.parse(
        await response.json()
      )
      const receipt = result.receipts[0]
      assert(receipt)
      assert.equal(receipt.state, 'succeeded')
      assert.equal(
        receipt.fields.find((field) => field.name === 'summary')?.value,
        'Approved historical title'
      )
      assert.equal(
        receipt.warning,
        'Issue created; assignment needs attention. Do not recreate the issue.'
      )
      assert(!JSON.stringify(result).includes('privatePayload'))
      const cases = [
        {
          status: 'completed',
          decision: 'allow',
          started: true,
          revoked: false,
          unknown: true,
          expected: 'uncertain',
        },
        {
          status: 'pending',
          decision: 'skip',
          started: false,
          revoked: false,
          unknown: false,
          expected: 'cancelled',
        },
        {
          status: 'cancelled',
          decision: 'allow',
          started: true,
          revoked: false,
          unknown: false,
          expected: 'uncertain',
        },
        {
          status: 'failed',
          decision: 'allow',
          started: true,
          revoked: true,
          unknown: true,
          expected: 'uncertain',
        },
        {
          status: 'failed',
          decision: 'allow',
          started: true,
          revoked: false,
          unknown: false,
          expected: 'failed',
        },
        {
          status: 'failed',
          decision: 'allow',
          started: false,
          revoked: false,
          unknown: false,
          expected: 'failed',
        },
        {
          status: 'pending',
          decision: 'allow',
          started: false,
          revoked: false,
          unknown: false,
          expected: 'cancelled',
        },
      ] as const
      for (const fixture of cases) {
        const id = generateId()
        await insertProposal(previousRunId, id, 'Historical outcome fixture')
        await sql`update copilot_async_tool_calls set status = ${fixture.status}, permission_decision = ${fixture.decision}, execution_started_at = ${fixture.started ? new Date() : null}, execution_settled_at = ${fixture.started ? new Date() : null}, execution_revoked_at = ${fixture.revoked ? new Date() : null}, result = ${sql.json({ outcomeUnknown: fixture.unknown, notStarted: !fixture.started })} where tool_call_id = ${id}`
        const stateResponse = await context.request.get(url, { params: { toolCallIds: id } })
        assert.equal(stateResponse.status(), 200)
        const state = listAssistantActionReceiptsContract.response.schema.parse(
          await stateResponse.json()
        ).receipts[0]
        assert.equal(state?.state, fixture.expected)
        assert.equal(state?.unsettled, false)
        await sql`delete from copilot_async_tool_calls where tool_call_id = ${id}`
      }
      await sql`update copilot_async_tool_calls set result = ${sql.json({ output: { warning: '😀'.repeat(1400) } })} where tool_call_id = ${previousCallId}`
      const unicodeResponse = await context.request.get(url, {
        params: { toolCallIds: previousCallId },
      })
      assert.equal(unicodeResponse.status(), 200)
      assert.equal(
        listAssistantActionReceiptsContract.response.schema.parse(await unicodeResponse.json())
          .receipts[0]?.warning,
        '😀'.repeat(1024)
      )
      await sql`update copilot_async_tool_calls set result = ${sql.json({ output: { warning: receipt.warning } })} where tool_call_id = ${previousCallId}`
      const scoped = await context.request.get(
        `${baseUrl.origin}/api/organizations/${organizationId}/chats/${lagChatId}/actions/receipts`,
        { params: { toolCallIds: previousCallId } }
      )
      assert.equal(scoped.status(), 200)
      assert.deepEqual(
        listAssistantActionReceiptsContract.response.schema.parse(await scoped.json()).receipts,
        []
      )
    }
  )
  await check(
    'Display history carries the canonical turn identity and clears copied identities',
    async () => {
      for (const suffix of ['', '?window=latest']) {
        const response = await context.request.get(
          `${baseUrl.origin}/api/mothership/chats/${assistantId}${suffix}`
        )
        assert.equal(response.status(), 200)
        const messages = toArray(toRecord(toRecord(await response.json()).chat).messages).map(
          toRecord
        )
        assert.equal(
          messages.find((message) => message.id === previousStreamId)?.streamId,
          previousStreamId
        )
      }
      const copiedId = generateId()
      await sql`insert into copilot_messages (id, chat_id, message_id, role, content, seq) values (${copiedId}, ${lagChatId}, ${copiedId}, 'assistant', ${sql.json({ id: copiedId, role: 'assistant', content: 'Copied history', timestamp: new Date().toISOString(), streamId: previousStreamId })}, 2)`
      try {
        const response = await context.request.get(
          `${baseUrl.origin}/api/mothership/chats/${lagChatId}`
        )
        assert.equal(response.status(), 200)
        const messages = toArray(toRecord(toRecord(await response.json()).chat).messages).map(
          toRecord
        )
        const copied = messages.find((message) => message.id === copiedId)
        assert(copied)
        assert.equal(copied.streamId, undefined)
      } finally {
        await sql`delete from copilot_messages where id = ${copiedId}`
      }
    }
  )
  await check('A native Assistant account exposes its own tool permissions', async () => {
    await page.goto(`${baseUrl.origin}${root}/integrations`, {
      waitUntil: 'domcontentloaded',
      timeout: 180_000,
    })
    await page.getByRole('link', { name: 'Open Salesforce integration', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Add account', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible()
    await capture('integration-account-actions')
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Disconnect Salesforce' })).toBeVisible()
    await capture('integration-disconnect-confirmation')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    const policy = page.getByRole('radiogroup', { name: 'Create Task in Salesforce permission' })
    await expect(policy).toBeVisible({ timeout: 180_000 })
    await expect(policy.getByRole('radio', { name: 'Ask', exact: true })).toBeChecked()
    await capture('integration-detail-salesforce')
  })
  await check('Integration details agree with the real Assistant tool catalog', async () => {
    for (const account of catalogAccounts) {
      await page.goto(`${baseUrl.origin}${root}/integrations`, { waitUntil: 'domcontentloaded' })
      const response = await context.request.get(
        `${baseUrl.origin}/api/organizations/${organizationId}/connected-accounts/personal/${account.credentialId}/tool-permissions`
      )
      assert.equal(response.status(), 200, await response.text())
      const data = readAssistantToolPermissionsContract.response.schema.parse(await response.json())
      assert.equal(data.account.credentialId, account.credentialId)
      assert.equal(data.tools.length > 0, account.supported, account.name)
      await page
        .getByRole('link', { name: `Open ${account.name} integration`, exact: true })
        .click()
      const permissions = page.getByRole('textbox', { name: 'Search tools', exact: true })
      if (account.supported) {
        await expect(permissions).toBeVisible()
        await expect(page.getByRole('radiogroup').first()).toBeVisible()
      } else {
        await expect(permissions).toHaveCount(0)
      }
      await capture(`integration-detail-${account.name.toLowerCase().replaceAll(' ', '-')}`)
    }
    await page.goto(`${baseUrl.origin}${root}/integrations`)
    await expect(
      page.getByRole('link', { name: 'Open Salesforce integration', exact: true })
    ).toBeVisible()
    await capture('integrations-desktop')
  })
  await check(
    'Multiple accounts isolate permissions and disconnect the selected account only',
    async () => {
      await page.goto(`${baseUrl.origin}${root}/integrations`)
      await page.getByRole('link', { name: 'Open Jira integration', exact: true }).click()
      await expect(page).toHaveURL((url) => url.searchParams.get('integration') === 'source:jira')
      const accountsUrl = page.url()
      const firstAccount = page.getByRole('link', {
        name: 'Open taylor@acme.example account',
        exact: true,
      })
      const secondAccount = page.getByRole('link', {
        name: 'Open launch-team@acme.example account',
        exact: true,
      })
      await expect(firstAccount).toBeVisible()
      await expect(secondAccount).toBeVisible()
      await expect(page.getByRole('textbox', { name: 'Search tools', exact: true })).toHaveCount(0)
      await capture('integration-multiple-accounts')
      await expect(
        page.getByRole('button', { name: 'Jira integration actions', exact: true })
      ).toHaveCount(0)
      await page.setViewportSize({ width: 390, height: 844 })
      await capture('integration-multiple-accounts-mobile')
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.setViewportSize({ width: 1440, height: 1000 })
      await secondAccount.click()
      await expect(page).toHaveURL((url) => url.searchParams.get('account') === secondCredentialId)
      const selectedUrl = page.url()
      const policy = page.getByRole('radiogroup', { name: 'Jira Write permission' })
      await expect(policy.getByRole('radio', { name: 'Ask', exact: true })).toBeChecked()
      await capture('integration-selected-account')
      await policy.getByRole('radio', { name: 'Block', exact: true }).click()
      await expect(policy.getByRole('radio', { name: 'Block', exact: true })).toBeChecked()
      await page.reload()
      await expect(policy.getByRole('radio', { name: 'Block', exact: true })).toBeChecked()
      for (const [id, expected] of [
        [credentialId, 'ask'],
        [secondCredentialId, 'block'],
      ] as const) {
        const response = await context.request.get(
          `${baseUrl.origin}/api/organizations/${organizationId}/connected-accounts/personal/${id}/tool-permissions`
        )
        assert.equal(response.status(), 200)
        const permissions = readAssistantToolPermissionsContract.response.schema.parse(
          await response.json()
        )
        assert.equal(
          permissions.tools.find((tool) => tool.toolId === 'jira_write')?.policy,
          expected
        )
      }
      await page.getByRole('link', { name: 'Jira', exact: true }).click()
      await expect(firstAccount).toBeVisible()
      await firstAccount.click()
      await expect(policy.getByRole('radio', { name: 'Ask', exact: true })).toBeChecked()
      await page.goto(selectedUrl)
      await expect(page.getByRole('button', { name: 'Reconnect', exact: true })).toBeVisible()
      await expect(policy.getByRole('radio', { name: 'Block', exact: true })).toBeChecked()
      await capture('integration-selected-account-actions')
      await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
      const confirmation = page.getByRole('dialog', { name: 'Disconnect Jira', exact: true })
      await expect(confirmation).toContainText('launch-team@acme.example')
      await expect(confirmation).not.toContainText('taylor@acme.example')
      await capture('integration-selected-account-disconnect')
      const disconnected = page.waitForResponse(
        (response) =>
          response.request().method() === 'DELETE' &&
          new URL(response.url()).pathname ===
            `/api/users/me/organization-accounts/${secondCredentialId}`
      )
      await confirmation.getByRole('button', { name: 'Disconnect', exact: true }).click()
      assert.equal((await disconnected).status(), 200)
      await expect(confirmation).toBeHidden()
      await expect(
        page.getByText('This account is no longer connected.', { exact: true })
      ).toBeVisible()
      await expect(page.getByRole('textbox', { name: 'Search tools', exact: true })).toHaveCount(0)
      const states =
        await sql`select id, managed_oauth_status from credential where id in (${credentialId}, ${secondCredentialId})`
      assert.equal(
        states.find((account) => account.id === credentialId)?.managed_oauth_status,
        'active'
      )
      assert.equal(
        states.find((account) => account.id === secondCredentialId)?.managed_oauth_status,
        'revoked'
      )
      await page.goto(accountsUrl)
      await expect(policy.getByRole('radio', { name: 'Ask', exact: true })).toBeChecked()
    }
  )
  await check(
    'Enabled, disabled and paused empty integrations preserve MCP account isolation',
    async () => {
      const inventoryResponse = await context.request.get(
        `${baseUrl.origin}/api/organizations/${organizationId}/connected-accounts`
      )
      assert.equal(inventoryResponse.status(), 200)
      const inventory = getOrganizationAccountsContract.response.schema.parse(
        await inventoryResponse.json()
      )
      assert(
        inventory.viewerMcpAccounts?.some(
          (account) => account.credentialId === firefliesCredentialId
        )
      )
      await page.goto(`${baseUrl.origin}${root}/integrations`)
      await page.getByRole('link', { name: 'Open Coda integration', exact: true }).click()
      await expect(page).toHaveURL((url) => url.searchParams.get('integration') === 'source:coda')
      const detailUrl = page.url()
      const connect = page.getByRole('button', { name: 'Connect', exact: true })
      await expect(connect).toBeEnabled()
      await expect(page.getByText('No account connected', { exact: true })).toBeVisible()
      await expect(page.getByText('meetings@acme.example', { exact: true })).toHaveCount(0)
      await capture('integration-enabled-empty')
      const forgedUrl = new URL(detailUrl)
      forgedUrl.searchParams.set('account', firefliesCredentialId)
      await page.goto(forgedUrl.toString())
      await expect(
        page.getByText('This account is no longer connected.', { exact: true })
      ).toBeVisible()
      await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toHaveCount(0)
      await expect(page.getByRole('textbox', { name: 'Search tools', exact: true })).toHaveCount(0)
      await sql`update organization_search_integration set approved = false where organization_id = ${organizationId} and connector_type = 'coda'`
      try {
        await page.goto(`${baseUrl.origin}${root}/integrations`)
        await expect(
          page.getByRole('link', { name: 'Open Coda integration', exact: true })
        ).toBeVisible()
        await page.getByRole('link', { name: 'Open Coda integration', exact: true }).click()
        await expect(page).toHaveURL((url) => url.searchParams.get('integration') === 'source:coda')
        await expect(page.getByText('Disabled by your organization', { exact: true })).toBeVisible()
        await expect(connect).toBeDisabled()
        await capture('integration-disabled-empty')
      } finally {
        await sql`update organization_search_integration set approved = true where organization_id = ${organizationId} and connector_type = 'coda'`
      }
      await sql`update credential_group set status = 'disabled' where id = ${groupId}`
      try {
        await page.reload()
        await expect(
          page.getByText('Connections are paused by your organization', { exact: true })
        ).toBeVisible()
        await expect(connect).toBeDisabled()
        await capture('integration-paused-empty')
      } finally {
        await sql`update credential_group set status = 'active' where id = ${groupId}`
      }
      await sql`update credential set managed_oauth_status = 'revoked' where id = ${nativeCredentialId}`
      await sql`update credential_group set options = (select jsonb_agg(case when value->>'id' = 'salesforce' then value || '{"status":"disabled"}'::jsonb else value end) from jsonb_array_elements(options)) where id = ${groupId}`
      try {
        await page.goto(`${baseUrl.origin}${root}/integrations`)
        const salesforce = page.getByRole('link', {
          name: 'Open Salesforce integration',
          exact: true,
        })
        await expect(salesforce).toBeVisible()
        await salesforce.click()
        await expect(page).toHaveURL(
          (url) => url.searchParams.get('integration') === 'app:salesforce'
        )
        await expect(page.getByText('No account connected', { exact: true })).toBeVisible()
        await expect(page.getByText('Connections unavailable', { exact: true })).toBeVisible()
        await expect(connect).toHaveCount(0)
        await capture('integration-disabled-app-empty')
      } finally {
        await sql`update credential set managed_oauth_status = 'active' where id = ${nativeCredentialId}`
        await sql`update credential_group set options = (select jsonb_agg(case when value->>'id' = 'salesforce' then value || '{"status":"active"}'::jsonb else value end) from jsonb_array_elements(options)) where id = ${groupId}`
      }
    }
  )
  await check(
    'Email review keeps recipients and exact content safe through editing and receipts',
    async () => {
      const gmail = catalogAccounts.find((account) => account.option === 'gmail')
      assert(gmail)
      const emailChatId = generateId()
      const emailRunId = generateId()
      const emailStreamId = generateId()
      const messages = [
        {
          callId: generateId(),
          subject: 'Launch update',
          contentType: 'text',
          body: 'The launch checklist is ready. Please confirm the final owner.',
        },
        {
          callId: generateId(),
          subject: 'HTML launch update',
          contentType: 'html',
          body: `<p>Review the launch checklist.</p><img src="${baseUrl.origin}/assistant-preview-probe" onerror="document.body.dataset.previewExecuted='true'">`,
        },
      ]
      const argsFor = (message: (typeof messages)[number]) => ({
        credential: gmail.credentialId,
        to: 'launch-team@example.test',
        cc: 'reviewer@example.test',
        bcc: 'archive@example.test',
        subject: message.subject,
        body: message.body,
        contentType: message.contentType,
      })
      await sql.begin(async (tx) => {
        await tx`insert into copilot_chats (id, user_id, organization_id, type, title, conversation_id, config)
        values (${emailChatId}, ${userId}, ${organizationId}, 'mothership', 'Email review', ${emailStreamId}, ${tx.json({ conversationMode: 'assistant' })})`
        await tx`insert into copilot_messages (id, chat_id, message_id, role, stream_id, content, seq)
        values (${generateId()}, ${emailChatId}, ${emailStreamId}, 'user', ${emailStreamId}, ${tx.json({ id: emailStreamId, role: 'user', content: 'Prepare the launch update emails.', requestId, timestamp: new Date().toISOString() })}, 1)`
        await tx`insert into copilot_runs (id, chat_id, user_id, organization_id, execution_id, stream_id, tool_execution_version, status)
        values (${emailRunId}, ${emailChatId}, ${userId}, ${organizationId}, ${generateId()}, ${emailStreamId}, 3, 'paused_waiting_for_tool')`
        for (const message of messages) {
          await tx`insert into copilot_async_tool_calls (run_id, tool_call_id, tool_name, executable_name, args, assistant_action, execution_retryable, permission_requested_at)
          values (${emailRunId}, ${message.callId}, 'gmail_send_v2', 'gmail_send_v2', ${tx.json(argsFor(message))}, ${tx.json({ credentialId: gmail.credentialId, operationVersion: 1, effect: 'write' })}, false, now())`
        }
      })
      fixtureStreams.push({ chatId: emailChatId, streamId: emailStreamId })
      assert(await acquirePendingChatStream(emailChatId, emailStreamId, 0))
      streamPollers.push(
        startAbortPoller(emailStreamId, new AbortController(), { chatId: emailChatId })
      )
      await appendStreamEvents(emailChatId, emailStreamId, [
        { type: 'session', payload: { kind: 'start' } },
        {
          type: 'text',
          payload: { channel: 'assistant', text: 'Review these emails before sending.' },
        },
        ...messages.map((message) => ({
          type: 'tool' as const,
          payload: {
            phase: 'call' as const,
            executor: 'sim' as const,
            mode: 'async' as const,
            toolCallId: message.callId,
            toolName: 'gmail_send_v2',
            status: 'awaiting_approval' as const,
            arguments: argsFor(message),
          },
        })),
      ])
      let contentRequested = false
      await page.route('**/assistant-preview-probe', async (route) => {
        contentRequested = true
        await route.abort()
      })
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.emulateMedia({ colorScheme: 'dark' })
      await page.goto(`${baseUrl.origin}${root}/search/chat/${emailChatId}`)
      const emails = page.getByRole('region', { name: 'Review Send email', exact: true })
      await expect(emails).toHaveCount(2)
      for (const message of messages) {
        const email = emails.filter({ hasText: message.subject }).filter({
          has: page
            .getByRole('region', { name: 'Message preview', exact: true })
            .filter({ hasText: message.body }),
        })
        await expect(email).toHaveCount(1)
        for (const address of [
          'launch-team@example.test',
          'reviewer@example.test',
          'archive@example.test',
        ]) {
          await expect(email.getByText(address, { exact: true })).toBeVisible()
        }
        assert.equal(
          await email.getByRole('region', { name: 'Message preview', exact: true }).textContent(),
          message.body
        )
        await email.getByRole('button', { name: 'Details', exact: true }).click()
      }
      await capture('email-review-desktop')
      const plainIndex = (await emails.allTextContents()).findIndex((content) =>
        content.includes(messages[0].body)
      )
      assert(plainIndex >= 0)
      const plain = emails.nth(plainIndex)
      await plain.getByRole('button', { name: 'Edit', exact: true }).click()
      const editedBody = 'Please confirm the owner by Friday.\nThank you.'
      await plain.getByRole('textbox', { name: 'Message', exact: true }).fill(editedBody)
      await expect(plain.getByRole('textbox', { name: 'To', exact: true })).toHaveCount(0)
      await plain.getByRole('button', { name: 'Done', exact: true }).click()
      await expect(plain.getByRole('region', { name: 'Message preview', exact: true })).toHaveText(
        editedBody
      )
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 844 })
        await emails.first().scrollIntoViewIfNeeded()
        await capture(`email-review-${width}`)
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          'Email review overflows horizontally'
        )
      }
      await page.getByRole('button', { name: 'Cancel 2 shown', exact: true }).click()
      await expect(emails).toHaveCount(0)
      const receipts = page.getByRole('region', { name: 'Send email receipt', exact: true })
      await expect(receipts).toHaveCount(2)
      for (const receipt of await receipts.all()) {
        await receipt
          .getByRole('button', { name: 'View Send email receipt: Cancelled', exact: true })
          .click()
      }
      await capture('email-receipts-mobile')
      const response = await context.request.get(
        `${baseUrl.origin}/api/organizations/${organizationId}/chats/${emailChatId}/actions/receipts`,
        { params: { streamId: emailStreamId } }
      )
      assert.equal(response.status(), 200, await response.text())
      const saved = listAssistantActionReceiptsContract.response.schema.parse(await response.json())
      for (const message of messages) {
        const receipt = saved.receipts.find((entry) => entry.toolCallId === message.callId)
        assert(receipt)
        assert.equal(receipt.state, 'cancelled')
        for (const [name, value] of Object.entries(argsFor(message))) {
          if (name !== 'credential')
            assert.equal(receipt.fields.find((field) => field.name === name)?.value, value)
        }
      }
      assert.equal(contentRequested, false, 'Email markup fetched a resource')
      assert.equal(await page.evaluate(() => document.body.dataset.previewExecuted), undefined)
      await page.unroute('**/assistant-preview-probe')
      await page.emulateMedia({ colorScheme: 'light' })
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
  )
  await check('Personal permissions persist through the real settings route', async () => {
    await page.goto(`${baseUrl.origin}${root}/integrations/accounts/${credentialId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 180_000,
    })
    const policy = page.getByRole('radiogroup', { name: 'Jira Write permission' })
    await expect(policy).toBeVisible({ timeout: 180_000 })
    await expect(policy.getByRole('radio', { name: 'Ask', exact: true })).toBeChecked()
    await policy.getByRole('radio', { name: 'Block', exact: true }).click()
    await expect(policy.getByRole('radio', { name: 'Block', exact: true })).toBeChecked()
    await page.reload()
    await expect(policy.getByRole('radio', { name: 'Block', exact: true })).toBeChecked()
    await policy.getByRole('radio', { name: 'Ask', exact: true }).click()
    await expect(policy.getByRole('radio', { name: 'Ask', exact: true })).toBeChecked()
    await capture('tool-permissions-desktop')
    await page.setViewportSize({ width: 390, height: 844 })
    await capture('tool-permissions-mobile')
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'Mobile permissions overflow horizontally'
    )
  })
  await check(
    'A live Assistant turn restores exact inline actions without duplicating older rows',
    async () => {
      await page.setViewportSize({ width: 1440, height: 1000 })
      const reviewUrl = `${baseUrl.origin}/api/organizations/${organizationId}/chats/${assistantId}/actions`
      await page.route(reviewUrl, async (route) => {
        const response = await route.fetch()
        const review = listAssistantActionsContract.response.schema.parse(await response.json())
        await route.fulfill({
          response,
          json: { ...review, actions: review.actions.map(({ sequence, ...action }) => action) },
        })
      })
      const streamResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/mothership/chat/stream' &&
          new URL(response.url()).searchParams.get('streamId') === streamId,
        { timeout: 180_000 }
      )
      await page.goto(`${baseUrl.origin}${root}/search/chat/${assistantId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 180_000,
      })
      assert.equal((await streamResponse).status(), 200)
      const reviewResponse = await context.request.get(
        `${baseUrl.origin}/api/organizations/${organizationId}/chats/${assistantId}/actions`
      )
      assert.equal(reviewResponse.status(), 200, await reviewResponse.text())
      const restoredReview = listAssistantActionsContract.response.schema.parse(
        await reviewResponse.json()
      )
      assert.equal(restoredReview.actions.length, 2)
      await expect(reviewCards).toHaveCount(2)
      await page.unroute(reviewUrl)
      await expect(
        page
          .getByRole('region', { name: 'Create Jira issue receipt' })
          .filter({ hasText: 'Approved historical title' })
      ).toBeAttached()
      await expect(page.getByRole('button', { name: 'Allow', exact: true })).toHaveCount(2)
      await expect(reviewCards.getByRole('textbox')).toHaveCount(0)
      await expect(reviewCards.getByText('Priority', { exact: true })).toHaveCount(0)
      const previewBounds = await reviewCards.nth(0).boundingBox()
      assert(
        previewBounds && previewBounds.height < 310,
        'The default review should fit in a compact preview'
      )
      await expect(
        reviewCards.nth(0).getByText('Publish the launch checklist', { exact: true })
      ).toBeVisible()
      await expect(
        reviewCards.nth(1).getByText('Confirm the rollout owners', { exact: true })
      ).toBeVisible()
      const prompt = await page.getByText(question, { exact: true }).elementHandle()
      assert(prompt, 'The current user turn must be restored')
      assert(
        await reviewCards.evaluateAll(
          (cards, userPrompt) =>
            cards.every((card) =>
              Boolean(userPrompt.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING)
            ),
          prompt
        ),
        'Current actions rendered inside an earlier turn'
      )
      await prompt.dispose()
      await expect(reviewCards.nth(0).getByText('LAUNCH', { exact: true })).toBeVisible()
      await expect(
        reviewCards.nth(0).getByText('acme.atlassian.net', { exact: true })
      ).toBeVisible()
      await expect(page.getByRole('dialog', { name: 'Review Assistant actions' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Review', exact: true })).toHaveCount(0)
      const response = await context.request.get(
        `${baseUrl.origin}/api/organizations/${organizationId}/chats/${assistantId}/actions`
      )
      assert.equal(response.status(), 200, await response.text())
      const review = listAssistantActionsContract.response.schema.parse(await response.json())
      assert.equal(review.runId, runId)
      assert.equal(review.streamId, streamId)
      assert.notEqual(review.runId, requestId)
      assert.deepEqual(
        review.actions.map((action) => action.toolCallId),
        [firstCallId, secondCallId]
      )
      await page.reload()
      await expect(reviewCards).toHaveCount(2)
      await expect(
        reviewCards.nth(0).getByText('Publish the launch checklist', { exact: true })
      ).toBeVisible()
      await expect(
        page
          .getByRole('region', { name: 'Create Jira issue receipt' })
          .filter({ hasText: 'Approved historical title' })
      ).toBeAttached()
      await reviewCards.last().scrollIntoViewIfNeeded()
      await capture('assistant-actions-desktop')
      await capture('action-review-desktop')
      await page.setViewportSize({ width: 390, height: 844 })
      await reviewCards.nth(0).scrollIntoViewIfNeeded()
      await capture('action-review-mobile')
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'Mobile review overflows horizontally'
      )
    }
  )
  await check(
    'An inactive account prevents approval but keeps cancellation reachable',
    async () => {
      await sql`update credential set managed_oauth_status = 'needs_reauth' where id = ${credentialId}`
      try {
        await page.reload()
        await expect(reviewCards).toHaveCount(2)
        await expect(
          reviewCards.nth(0).getByRole('button', { name: 'Allow', exact: true })
        ).toBeDisabled()
        await expect(
          reviewCards.nth(1).getByRole('button', { name: 'Allow', exact: true })
        ).toBeDisabled()
        await expect(
          reviewCards.nth(0).getByRole('button', { name: 'Cancel', exact: true })
        ).toBeEnabled()
        await expect(
          page.getByRole('button', { name: 'Allow 2 shown', exact: true })
        ).toBeDisabled()
      } finally {
        await sql`update credential set managed_oauth_status = 'active' where id = ${credentialId}`
      }
      await page.reload()
      await expect(
        reviewCards.nth(0).getByRole('button', { name: 'Allow', exact: true })
      ).toBeEnabled()
    }
  )
  await check(
    'An edited approval and a cancellation affect only their saved proposals',
    async () => {
      await reviewCards.nth(0).getByRole('button', { name: 'Edit', exact: true }).click()
      await reviewCards
        .nth(0)
        .getByRole('textbox', { name: 'Summary', exact: true })
        .fill('Publish the reviewed launch checklist')
      await capture('action-review-edit')
      await reviewCards.nth(0).getByRole('button', { name: 'Done', exact: true }).click()
      await expect(
        reviewCards.nth(0).getByText('Publish the reviewed launch checklist', { exact: true })
      ).toBeVisible()
      const approval = page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          response.url().endsWith(`/actions/${firstCallId}`),
        { timeout: 180_000 }
      )
      await reviewCards.nth(0).getByRole('button', { name: 'Allow', exact: true }).click()
      const approvalResponse = await approval
      assert.equal(approvalResponse.status(), 200, await approvalResponse.text())
      await expect(reviewCards).toHaveCount(1)
      await expect(
        reviewCards.getByText('Confirm the rollout owners', { exact: true })
      ).toBeVisible()
      const approvedReceipt = page
        .getByRole('region', { name: 'Create Jira issue receipt' })
        .filter({ hasText: 'Publish the reviewed launch checklist' })
      await expect(
        approvedReceipt.getByRole('button', {
          name: 'View Create Jira issue receipt: Approved',
          exact: true,
        })
      ).toBeVisible()
      await approvedReceipt.getByRole('button', { name: 'View Create Jira issue receipt' }).click()
      await expect(approvedReceipt.getByRole('textbox')).toHaveCount(0)
      await expect(approvedReceipt.getByText('acme.atlassian.net', { exact: true })).toBeVisible()
      await approvedReceipt.getByRole('button', { name: 'Hide Create Jira issue receipt' }).click()
      const cancellation = page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          response.url().endsWith(`/actions/${secondCallId}`),
        { timeout: 180_000 }
      )
      await reviewCards.getByRole('button', { name: 'Cancel', exact: true }).click()
      const cancellationResponse = await cancellation
      assert.equal(cancellationResponse.status(), 200, await cancellationResponse.text())
      await expect(reviewCards).toHaveCount(0)
      const cancelledReceipt = page
        .getByRole('region', { name: 'Create Jira issue receipt' })
        .filter({ hasText: 'Confirm the rollout owners' })
      await expect(
        cancelledReceipt.getByRole('button', {
          name: 'View Create Jira issue receipt: Cancelled',
          exact: true,
        })
      ).toBeVisible()
      await capture('action-receipts-mobile')
      await page.setViewportSize({ width: 1440, height: 1000 })
      await capture('action-receipts-desktop')
      await page.reload()
      await expect(
        approvedReceipt.getByRole('button', {
          name: 'View Create Jira issue receipt: Approved',
          exact: true,
        })
      ).toBeVisible()
      await expect(
        cancelledReceipt.getByRole('button', {
          name: 'View Create Jira issue receipt: Cancelled',
          exact: true,
        })
      ).toBeVisible()
      const rows =
        await sql`select tool_call_id, permission_decision, args, approved_args, execution_started_at from copilot_async_tool_calls where run_id = ${runId} order by persist_seq`
      assert.equal(rows[0]?.permission_decision, 'allow')
      assert.equal(toRecord(rows[0]?.args).summary, 'Publish the launch checklist')
      assert.equal(
        toRecord(rows[0]?.approved_args).summary,
        'Publish the reviewed launch checklist'
      )
      assert.equal(rows[1]?.permission_decision, 'skip')
      assert(
        rows.every((row) => row.execution_started_at === null),
        'A fixture action executed'
      )
    }
  )
  await check(
    'Review recovers when an empty result becomes unavailable before the tool transcript arrives',
    async () => {
      const reviewUrl = `${baseUrl.origin}/api/organizations/${organizationId}/chats/${lagChatId}/actions`
      const initialReview = page.waitForResponse(
        (response) => response.request().method() === 'GET' && response.url() === reviewUrl
      )
      await page.goto(`${baseUrl.origin}${root}/search/chat/${lagChatId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 180_000,
      })
      const initialResponse = await initialReview
      assert.equal(initialResponse.status(), 200)
      const initialData = listAssistantActionsContract.response.schema.parse(
        await initialResponse.json()
      )
      assert.equal(initialData.runId, lagRunId)
      assert.equal(initialData.streamId, lagStreamId)
      assert.deepEqual(initialData.actions, [])
      await insertProposal(lagRunId, lagFirstCallId, 'Review the support handoff')
      await insertProposal(lagRunId, lagSecondCallId, 'Prepare the launch announcement')
      await page.route(reviewUrl, (route) =>
        route.request().method() === 'GET' ? route.abort('failed') : route.continue()
      )
      try {
        await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible({
          timeout: 15_000,
        })
        await expect(reviewCards).toHaveCount(0)
      } finally {
        await page.unroute(reviewUrl)
      }
      await page.getByRole('button', { name: 'Retry', exact: true }).click()
      await expect(reviewCards).toHaveCount(2)
      await expect(
        reviewCards.nth(0).getByText('Review the support handoff', { exact: true })
      ).toBeVisible()
      await expect(
        reviewCards.nth(1).getByText('Prepare the launch announcement', { exact: true })
      ).toBeVisible()
      await appendStreamEvents(lagChatId, lagStreamId, [
        pendingToolEvent(lagFirstCallId, 'Review the support handoff'),
        pendingToolEvent(lagSecondCallId, 'Prepare the launch announcement'),
        {
          type: 'text',
          payload: { channel: 'assistant', text: '\nThe action transcript has caught up.' },
        },
      ])
      await expect(
        page.getByText('The action transcript has caught up.', { exact: false })
      ).toBeVisible()
      await expect(reviewCards).toHaveCount(2)
      await page.reload()
      await expect(reviewCards).toHaveCount(2)
    }
  )
  await check(
    'A bulk approval keeps its clicked snapshot when another action arrives',
    async () => {
      const releaseFirstDecision = createDeferred<void>()
      let firstDecisionRequested = false
      const firstActionUrl = `${baseUrl.origin}/api/organizations/${organizationId}/chats/${lagChatId}/actions/${lagFirstCallId}`
      await page.route(firstActionUrl, async (route) => {
        firstDecisionRequested = true
        await releaseFirstDecision.promise
        await route.continue()
      })
      try {
        await page.getByRole('button', { name: 'Allow 2 shown', exact: true }).click()
        await expect.poll(() => firstDecisionRequested).toBe(true)
        await insertProposal(lagRunId, lateCallId, 'A later proposal that was never approved')
        await appendStreamEvents(lagChatId, lagStreamId, [
          pendingToolEvent(lateCallId, 'A later proposal that was never approved'),
        ])
        await expect(reviewCards).toHaveCount(3)
        releaseFirstDecision.resolve()
        await expect
          .poll(async () => {
            const rows =
              await sql`select tool_call_id, permission_decision from copilot_async_tool_calls where run_id = ${lagRunId} order by persist_seq`
            return rows.map((row) => [row.tool_call_id, row.permission_decision])
          })
          .toEqual([
            [lagFirstCallId, 'allow'],
            [lagSecondCallId, 'allow'],
            [lateCallId, null],
          ])
        await expect(reviewCards).toHaveCount(1)
        await expect(
          reviewCards.getByText('A later proposal that was never approved', { exact: true })
        ).toBeVisible()
        const cancellation = page.waitForResponse(
          (response) =>
            response.request().method() === 'PATCH' &&
            response.url().endsWith(`/actions/${lateCallId}`)
        )
        await reviewCards.getByRole('button', { name: 'Cancel', exact: true }).click()
        assert.equal((await cancellation).status(), 200)
        await expect(reviewCards).toHaveCount(0)
      } finally {
        releaseFirstDecision.resolve()
        await page.unroute(firstActionUrl)
      }
      const rows =
        await sql`select execution_started_at from copilot_async_tool_calls where run_id in (${runId}, ${lagRunId})`
      assert(
        rows.every((row) => row.execution_started_at === null),
        'A fixture action executed'
      )
    }
  )
  await check(
    'A failed keyboard decision keeps focus and leaves the proposal pending',
    async () => {
      for (const [id, summary] of [
        [keyboardCallId, 'Approve with the keyboard'],
        [otherFocusCallId, 'Keep focus in another field'],
        [navigationCallId, 'Leave this conversation during a decision'],
      ] as const) {
        await insertProposal(reviewRunId, id, summary)
        await appendStreamEvents(reviewChatId, reviewStreamId, [pendingToolEvent(id, summary)])
      }
      await page.goto(`${baseUrl.origin}${root}/search/chat/${reviewChatId}`)
      await expect(reviewCards).toHaveCount(3)
      const actionUrl = `${baseUrl.origin}/api/organizations/${organizationId}/chats/${reviewChatId}/actions/${keyboardCallId}`
      await page.route(
        actionUrl,
        (route) =>
          route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'The review could not be saved. Try again.' }),
          }),
        { times: 1 }
      )
      const response = page.waitForResponse(
        (response) => response.url() === actionUrl && response.request().method() === 'PATCH'
      )
      const allow = reviewCards.nth(0).getByRole('button', { name: 'Allow', exact: true })
      await allow.focus()
      await page.keyboard.press('Enter')
      assert.equal((await response).status(), 409)
      await expect(reviewCards.nth(0).getByRole('alert')).toBeVisible()
      await expect(allow).toBeEnabled()
      await expect(allow).toBeFocused()
      const [row] =
        await sql`select permission_decision, execution_started_at from copilot_async_tool_calls where tool_call_id = ${keyboardCallId}`
      assert.equal(row?.permission_decision, null)
      assert.equal(row?.execution_started_at, null)
    }
  )
  await check(
    'A completed keyboard decision restores focus without taking it from another field',
    async () => {
      const response = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/actions/${keyboardCallId}`) &&
          response.request().method() === 'PATCH'
      )
      await reviewCards.nth(0).getByRole('button', { name: 'Allow', exact: true }).focus()
      await page.keyboard.press('Enter')
      assert.equal((await response).status(), 200)
      await expect(reviewCards).toHaveCount(2)
      await expect(
        page
          .getByRole('group', { name: 'Conversation turn', exact: true })
          .filter({ has: page.getByText(reviewAnswer, { exact: true }) })
      ).toBeFocused()

      const releaseDecision = createDeferred<void>()
      let decisionRequested = false
      const actionUrl = `${baseUrl.origin}/api/organizations/${organizationId}/chats/${reviewChatId}/actions/${otherFocusCallId}`
      await page.route(actionUrl, async (route) => {
        decisionRequested = true
        await releaseDecision.promise
        await route.continue()
      })
      try {
        const cancellation = page.waitForResponse(
          (response) => response.url() === actionUrl && response.request().method() === 'PATCH'
        )
        await reviewCards.nth(0).getByRole('button', { name: 'Cancel', exact: true }).focus()
        await page.keyboard.press('Enter')
        await expect.poll(() => decisionRequested).toBe(true)
        const composer = page.getByRole('textbox', { name: 'Ask Sim', exact: true })
        await composer.fill('Keep my focus here')
        releaseDecision.resolve()
        assert.equal((await cancellation).status(), 200)
        await expect(reviewCards).toHaveCount(1)
        await expect(composer).toBeFocused()
      } finally {
        releaseDecision.resolve()
        await page.unroute(actionUrl)
      }
    }
  )
  for (const intent of ['focus', 'pointer'] as const) {
    await check(
      `A completed review respects ${intent} movement away from its control`,
      async () => {
        const toolCallId = generateId()
        const summary = `Preserve the user's ${intent} intent`
        await insertProposal(reviewRunId, toolCallId, summary)
        await appendStreamEvents(reviewChatId, reviewStreamId, [
          pendingToolEvent(toolCallId, summary),
        ])
        await expect(reviewCards).toHaveCount(2)
        const releaseDecision = createDeferred<void>()
        let decisionRequested = false
        const actionUrl = `${baseUrl.origin}/api/organizations/${organizationId}/chats/${reviewChatId}/actions/${toolCallId}`
        await page.route(actionUrl, async (route) => {
          decisionRequested = true
          await releaseDecision.promise
          await route.continue()
        })
        try {
          await reviewCards.last().getByRole('button', { name: 'Cancel', exact: true }).focus()
          await page.keyboard.press('Enter')
          await expect.poll(() => decisionRequested).toBe(true)
          if (intent === 'focus') {
            const composer = page.getByRole('textbox', { name: 'Ask Sim', exact: true })
            await composer.fill('Continue elsewhere')
            await expect(composer).toBeFocused()
            await composer.evaluate((element) => {
              if (element instanceof HTMLElement) element.blur()
            })
          } else {
            await page.locator('body').click({ position: { x: 1, y: 1 } })
          }
          await expect(page.locator('body')).toBeFocused()
          const response = page.waitForResponse(
            (response) => response.url() === actionUrl && response.request().method() === 'PATCH'
          )
          releaseDecision.resolve()
          assert.equal((await response).status(), 200)
          await expect(reviewCards).toHaveCount(1)
          await expect(page.locator('body')).toBeFocused()
          const [row] =
            await sql`select permission_decision, execution_started_at from copilot_async_tool_calls where tool_call_id = ${toolCallId}`
          assert.equal(row?.permission_decision, 'skip')
          assert.equal(row?.execution_started_at, null)
        } finally {
          releaseDecision.resolve()
          await page.unroute(actionUrl)
        }
      }
    )
  }
  await check(
    'A decision completing after navigation does not take focus from Search',
    async () => {
      let decisionPersisted = false
      const releaseResponse = createDeferred<void>()
      let responseReleased = false
      const actionUrl = `${baseUrl.origin}/api/organizations/${organizationId}/chats/${reviewChatId}/actions/${navigationCallId}`
      await page.route(actionUrl, async (route) => {
        const response = await route.fetch()
        assert.equal(response.status(), 200)
        decisionPersisted = true
        await releaseResponse.promise
        try {
          await route.fulfill({ response })
        } finally {
          responseReleased = true
        }
      })
      try {
        await expect(reviewCards.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled()
        await reviewCards.getByRole('button', { name: 'Cancel', exact: true }).focus()
        await page.keyboard.press('Enter')
        await expect.poll(() => decisionPersisted).toBe(true)
        await page.goto(`${baseUrl.origin}${root}/search`)
        const search = page.getByRole('textbox', { name: 'Search your sources', exact: true })
        await search.fill('Continue searching')
        releaseResponse.resolve()
        await expect.poll(() => responseReleased).toBe(true)
        await expect(search).toBeFocused()
        const [row] =
          await sql`select permission_decision, execution_started_at from copilot_async_tool_calls where tool_call_id = ${navigationCallId}`
        assert.equal(row?.permission_decision, 'skip')
        assert.equal(row?.execution_started_at, null)
      } finally {
        releaseResponse.resolve()
        await page.unroute(actionUrl)
      }
    }
  )
  await check('Cancel all skips its displayed snapshot after a selective approval', async () => {
    for (const [id, summary] of [
      [selectiveCallId, 'Allow this proposal separately'],
      [batchFirstCallId, 'Cancel the first pending proposal'],
      [batchSecondCallId, 'Cancel the second pending proposal'],
    ] as const) {
      await insertProposal(reviewRunId, id, summary)
      await appendStreamEvents(reviewChatId, reviewStreamId, [pendingToolEvent(id, summary)])
    }
    await page.goto(`${baseUrl.origin}${root}/search/chat/${reviewChatId}`)
    await expect(reviewCards).toHaveCount(3)
    const approval = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/actions/${selectiveCallId}`) &&
        response.request().method() === 'PATCH'
    )
    await reviewCards.nth(0).getByRole('button', { name: 'Allow', exact: true }).click()
    assert.equal((await approval).status(), 200)
    await expect(reviewCards).toHaveCount(2)
    const releaseFirstDecision = createDeferred<void>()
    let firstDecisionRequested = false
    const firstActionUrl = `${baseUrl.origin}/api/organizations/${organizationId}/chats/${reviewChatId}/actions/${batchFirstCallId}`
    await page.route(firstActionUrl, async (route) => {
      firstDecisionRequested = true
      await releaseFirstDecision.promise
      await route.continue()
    })
    try {
      await page.getByRole('button', { name: 'Cancel 2 shown', exact: true }).click()
      await expect.poll(() => firstDecisionRequested).toBe(true)
      await insertProposal(reviewRunId, batchLateCallId, 'This later proposal was not canceled')
      await appendStreamEvents(reviewChatId, reviewStreamId, [
        pendingToolEvent(batchLateCallId, 'This later proposal was not canceled'),
      ])
      await expect(reviewCards).toHaveCount(3)
      releaseFirstDecision.resolve()
      await expect
        .poll(async () => {
          const rows =
            await sql`select tool_call_id, permission_decision from copilot_async_tool_calls where tool_call_id in (${selectiveCallId}, ${batchFirstCallId}, ${batchSecondCallId}, ${batchLateCallId}) order by persist_seq`
          return rows.map((row) => [row.tool_call_id, row.permission_decision])
        })
        .toEqual([
          [selectiveCallId, 'allow'],
          [batchFirstCallId, 'skip'],
          [batchSecondCallId, 'skip'],
          [batchLateCallId, null],
        ])
      await expect(reviewCards).toHaveCount(1)
      const cancellation = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/actions/${batchLateCallId}`) &&
          response.request().method() === 'PATCH'
      )
      await reviewCards.getByRole('button', { name: 'Cancel', exact: true }).click()
      assert.equal((await cancellation).status(), 200)
      await expect(reviewCards).toHaveCount(0)
    } finally {
      releaseFirstDecision.resolve()
      await page.unroute(firstActionUrl)
    }
    const rows =
      await sql`select execution_started_at from copilot_async_tool_calls where run_id = ${reviewRunId}`
    assert(
      rows.every((row) => row.execution_started_at === null),
      'A fixture action executed'
    )
  })
  await check('An organization URL cannot expose a different organization’s review', async () => {
    const response = await context.request.get(
      `${baseUrl.origin}/api/organizations/${otherOrganizationId}/chats/${assistantId}/actions`
    )
    assert.equal(response.status(), 404)
  })
  await check(
    'A 64-action recovery preserves sequence, pagination and receipts with bounded requests',
    async () => {
      const batchIds = Array.from({ length: 64 }, () => generateId())
      for (const [index, id] of batchIds.entries()) {
        await insertProposal(bulkRunId, id, `Batch issue ${index + 1}`)
        if (index % 2 === 0) {
          await sql`update copilot_async_tool_calls set status = 'delivered', permission_decision = 'skip', permission_decided_at = now() where run_id = ${bulkRunId} and tool_call_id = ${id}`
        }
      }
      await appendStreamEvents(bulkChatId, bulkStreamId, [
        { type: 'session', payload: { kind: 'start' } },
        { type: 'text', payload: { channel: 'assistant', text: 'Review the remaining actions.' } },
      ])
      const responsesBefore = httpResponses.length
      await page.goto(`${baseUrl.origin}/o/${organizationId}/chat/${bulkChatId}?mode=assistant`)
      const cards = page.locator(
        'section[aria-label="Review Create Jira issue"], section[aria-label="Create Jira issue receipt"]'
      )
      await expect(cards).toHaveCount(48)
      await expect(cards.nth(0)).toContainText('Batch issue 1')
      await expect(cards.nth(0)).toContainText('Cancelled')
      await expect(cards.nth(1)).toContainText('Batch issue 2')
      const initialReceiptRequests = httpResponses
        .slice(responsesBefore)
        .filter((response) => response.path.endsWith('/actions/receipts'))
      assert(
        initialReceiptRequests.length <= 6,
        `Recovery made ${initialReceiptRequests.length} receipt requests`
      )
      await cards.nth(1).getByRole('button', { name: 'Allow', exact: true }).click()
      await expect(cards.nth(1)).toContainText('Approved')
      await expect(cards.nth(1)).toContainText('Batch issue 2')
      await expect(cards.last()).toContainText('Batch issue 64')
      await cards.last().getByRole('button', { name: 'Allow', exact: true }).click()
      await expect(cards.last()).toContainText('Approved')
      await expect(cards).toHaveCount(48)
      await page.getByRole('button', { name: 'More action history', exact: true }).click()
      await expect(cards).toHaveCount(64)
      await page.reload()
      await page.getByRole('button', { name: 'More action history', exact: true }).click()
      await expect(cards).toHaveCount(64)
      await expect(cards.nth(1)).toContainText('Approved')
      await expect(cards.last()).toContainText('Approved')
      await expect(cards.last()).toContainText('Batch issue 64')
      await capture('approval-paginated-receipts')
      const lastCallId = batchIds.at(-1)
      const precedingCallId = batchIds.at(-3)
      assert(lastCallId && precedingCallId)
      await cards.nth(61).getByRole('button', { name: 'Allow', exact: true }).click()
      await expect(cards.nth(61)).toContainText('Approved')
      await sql`update copilot_async_tool_calls set status = 'completed', execution_started_at = now(), execution_settled_at = now(), completed_at = now(), result = ${sql.json({ success: true })} where run_id = ${bulkRunId} and tool_call_id = ${lastCallId}`
      const receiptsUrl = `${baseUrl.origin}/api/organizations/${organizationId}/chats/${bulkChatId}/actions/receipts`
      for (const [index, fixture] of [
        { id: lastCallId, summary: 'Batch issue 64', state: 'Completed' },
        { id: precedingCallId, summary: 'Batch issue 62', state: 'Approved' },
      ].entries()) {
        const events = [pendingToolEvent(fixture.id, fixture.summary)]
        if (fixture.state === 'Completed')
          events.push({
            type: 'tool',
            payload: {
              phase: 'result',
              executor: 'sim',
              mode: 'async',
              toolCallId: fixture.id,
              toolName: 'jira_write',
              success: true,
              status: 'success',
              output: { success: true },
            },
          })
        await appendStreamEvents(bulkChatId, bulkStreamId, events)
        await page.route(`${receiptsUrl}*`, (route) => {
          const ids = new URL(route.request().url()).searchParams.getAll('toolCallIds')
          return ids.includes(fixture.id) ? route.abort('failed') : route.continue()
        })
        try {
          await page.reload()
          await expect(
            page.getByText('Could not load action history', { exact: true })
          ).toHaveCount(index + 1, { timeout: 15_000 })
          await capture(`receipt-history-${fixture.state.toLowerCase()}-retry`)
        } finally {
          await page.unroute(`${receiptsUrl}*`)
        }
        await page.getByRole('button', { name: 'Retry', exact: true }).first().click()
        await expect(
          page
            .getByRole('region', { name: 'Create Jira issue receipt' })
            .filter({ hasText: fixture.summary })
        ).toContainText(fixture.state)
      }
    }
  )
  await check(
    'Automatically allowed writes wait for execution, not a second approval',
    async () => {
      const autoCallId = generateId()
      await insertProposal(runId, autoCallId, 'Automatically allowed issue')
      await sql`update copilot_async_tool_calls set permission_requested_at = null where run_id = ${runId} and tool_call_id = ${autoCallId}`
      try {
        const response = await context.request.get(
          `${baseUrl.origin}/api/organizations/${organizationId}/chats/${assistantId}/actions/receipts`,
          { params: { toolCallIds: autoCallId } }
        )
        assert.equal(response.status(), 200, await response.text())
        const result = listAssistantActionReceiptsContract.response.schema.parse(
          await response.json()
        )
        assert.equal(result.receipts[0]?.state, 'approved')
      } finally {
        await sql`delete from copilot_async_tool_calls where run_id = ${runId} and tool_call_id = ${autoCallId}`
      }
    }
  )
  await check('Browser runtime and HTTP responses', async () => {
    assert.deepEqual(browserErrors, [])
    assert.deepEqual(serverErrors, [])
  })
} catch (error) {
  await writeFile(`${artifactDirectory}/failure.txt`, await page.locator('body').innerText()).catch(
    () => undefined
  )
  logger.error('Assistant actions E2E failed', { error: getErrorMessage(error) })
  await page.screenshot({ path: resolve(artifactDirectory, 'failure.png') }).catch(() => undefined)
  process.exitCode = 1
} finally {
  await browser.close()
  for (const poller of streamPollers) clearInterval(poller)
  try {
    for (const stream of fixtureStreams)
      await releasePendingChatStream(stream.chatId, stream.streamId)
    await sql`delete from workspace where owner_id = ${userId}`
    await sql`delete from project where owner_id = ${userId}`
    await sql`delete from organization where id in (${organizationId},${otherOrganizationId})`
    await sql`delete from "user" where id = ${userId}`
    for (const stream of fixtureStreams) await clearBuffer(stream.streamId)
  } catch (error) {
    checks.push({
      name: 'Fixture cleanup',
      status: 'failed',
      durationMs: 0,
      error: getErrorMessage(error),
    })
    process.exitCode = 1
  } finally {
    await sql.end()
    await closeRedisConnection()
  }
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(
    reportPath,
    JSON.stringify(
      { checks, browserErrors, browserMessages, serverErrors, httpResponses, artifactDirectory },
      null,
      2
    )
  )
}
