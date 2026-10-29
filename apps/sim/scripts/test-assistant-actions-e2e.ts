import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createLogger } from '@sim/logger'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId, generateShortId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { makeSignature } from 'better-auth/crypto'
import postgres from 'postgres'
import {
  listAssistantActionsContract,
  readAssistantToolPermissionsContract,
} from '@/lib/api/contracts/assistant-actions'
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
const browserErrors: string[] = []
const serverErrors: { path: string; status: number }[] = []
const httpResponses: { method: string; path: string; status: number }[] = []
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
const reviewCards = page.getByRole('region', { name: 'Review Jira Write', exact: true })
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
      values (${groupId}, ${organizationId}, ${generateId()}, 'Personal Jira', ${tx.json(['jira', 'salesforce', ...catalogAccounts.map((account) => account.option)].map((provider) => ({ id: provider, provider, label: provider, authorizationAppId: 'fixture', requiredScopes: [], scopeVersion: 1, required: false, status: 'active' })))})`
    await tx`insert into resource_policy (id, organization_id, resource_type, resource_id, document, created_by, updated_by)
      values (${generateId()}, ${organizationId}, 'credential_group', ${groupId}, ${tx.json({ version: 2, resource: { type: 'credential_group', id: groupId }, statements: [] })}, ${userId}, ${userId})`
    await tx`insert into credential_group_enrollment (id, credential_group_id, user_id, email, status, invitation_token_hash, invitation_expires_at, invited_at)
      values (${enrollmentId}, ${groupId}, ${userId}, ${email}, 'completed', ${enrollmentId.replaceAll('-', '').repeat(2)}, now() + interval '1 day', now())`
    await tx`insert into credential (id, organization_id, type, created_by, display_name, provider_id, credential_group_enrollment_id, credential_group_option_id, managed_oauth_status, managed_oauth_scope_version, granted_scopes, provider_subject_id, authorization_app_id, encrypted_oauth_token_set, granted_at)
      values (${credentialId}, ${organizationId}, 'managed_oauth', ${userId}, 'taylor@acme.example', 'jira', ${enrollmentId}, 'jira', 'active', 1, '{}'::text[], ${userId}, 'fixture', 'fixture-not-a-provider-token', now())`
    await tx`insert into credential (id, organization_id, type, created_by, display_name, provider_id, credential_group_enrollment_id, credential_group_option_id, managed_oauth_status, managed_oauth_scope_version, granted_scopes, provider_subject_id, authorization_app_id, encrypted_oauth_token_set, granted_at)
      values (${nativeCredentialId}, ${organizationId}, 'managed_oauth', ${userId}, 'taylor@acme.example', 'salesforce', ${enrollmentId}, 'salesforce', 'active', 1, '{}'::text[], ${userId}, 'fixture', 'fixture-not-a-provider-token', now())`
    for (const account of catalogAccounts) {
      await tx`insert into credential (id, organization_id, type, created_by, display_name, provider_id, credential_group_enrollment_id, credential_group_option_id, managed_oauth_status, managed_oauth_scope_version, granted_scopes, provider_subject_id, authorization_app_id, encrypted_oauth_token_set, granted_at)
        values (${account.credentialId}, ${organizationId}, 'managed_oauth', ${userId}, 'taylor@acme.example', ${account.provider}, ${enrollmentId}, ${account.option}, 'active', 1, '{}'::text[], ${userId}, 'fixture', 'fixture-not-a-provider-token', now())`
    }
    await tx`insert into copilot_chats (id, user_id, organization_id, type, title, conversation_id, config)
      values (${assistantId}, ${userId}, ${organizationId}, 'mothership', 'Launch follow-up', ${streamId}, ${tx.json({ conversationMode: 'assistant' })}),
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
      values (${generateId()}, ${lagChatId}, ${lagStreamId}, 'user', ${lagStreamId}, ${tx.json({ id: lagStreamId, role: 'user', content: 'Create two more Jira issues.', requestId, timestamp: new Date().toISOString() })}, 1),
      (${generateId()}, ${reviewChatId}, ${reviewStreamId}, 'user', ${reviewStreamId}, ${tx.json({ id: reviewStreamId, role: 'user', content: 'Prepare follow-up actions for review.', requestId, timestamp: new Date().toISOString() })}, 1)`
    await tx`insert into copilot_runs (id, chat_id, user_id, organization_id, execution_id, stream_id, tool_execution_version, status, started_at, completed_at, tool_admission_closed_at)
      values (${previousRunId}, ${assistantId}, ${userId}, ${organizationId}, ${generateId()}, ${previousStreamId}, 3, 'complete', now() - interval '1 hour', now() - interval '59 minutes', now() - interval '59 minutes')`
    await tx`insert into copilot_runs (id, chat_id, user_id, organization_id, execution_id, stream_id, tool_execution_version, status)
      values (${runId}, ${assistantId}, ${userId}, ${organizationId}, ${generateId()}, ${streamId}, 3, 'paused_waiting_for_tool'),
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
  await check('A native Assistant account exposes its own tool permissions', async () => {
    await page.goto(`${baseUrl.origin}${root}/integrations`, {
      waitUntil: 'domcontentloaded',
      timeout: 180_000,
    })
    await page.getByRole('button', { name: 'Salesforce integration actions', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: 'Add account', exact: true })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Reconnect', exact: true })).toBeVisible()
    const permissions = page.locator(
      `a[href="${root}/integrations/accounts/${nativeCredentialId}"]`
    )
    await expect(permissions).toBeVisible({ timeout: 180_000 })
    await permissions.click()
    const policy = page.getByRole('radiogroup', { name: 'Create Task in Salesforce permission' })
    await expect(policy).toBeVisible({ timeout: 180_000 })
    await expect(policy.getByRole('radio', { name: 'Ask', exact: true })).toBeChecked()
  })
  await check('Connected app menus agree with the real Assistant tool catalog', async () => {
    await page.goto(`${baseUrl.origin}${root}/integrations`, { waitUntil: 'domcontentloaded' })
    for (const account of catalogAccounts) {
      const response = await context.request.get(
        `${baseUrl.origin}/api/organizations/${organizationId}/connected-accounts/personal/${account.credentialId}/tool-permissions`
      )
      assert.equal(response.status(), 200, await response.text())
      const data = readAssistantToolPermissionsContract.response.schema.parse(await response.json())
      assert.equal(data.account.credentialId, account.credentialId)
      assert.equal(data.tools.length > 0, account.supported, account.name)
      const menu = page.getByRole('button', {
        name: `${account.name} integration actions`,
        exact: true,
      })
      await expect(menu).toHaveCount(1)
      await menu.click()
      const permissions = page.getByRole('menu').locator('a[href*="/integrations/accounts/"]')
      await expect(permissions).toHaveCount(account.supported ? 1 : 0)
      if (account.supported) {
        await expect(permissions).toHaveAttribute(
          'href',
          `${root}/integrations/accounts/${account.credentialId}`
        )
      } else {
        await expect(permissions).toHaveCount(0)
      }
      await page.keyboard.press('Escape')
    }
    await capture('integrations-desktop')
  })
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
      await expect(reviewCards).toHaveCount(2, { timeout: 180_000 })
      await expect(page.getByText('Earlier Jira proposal', { exact: false })).toBeAttached()
      await expect(page.getByRole('button', { name: 'Allow', exact: true })).toHaveCount(2)
      await expect(
        reviewCards.nth(0).getByRole('textbox', { name: 'Summary', exact: true })
      ).toHaveValue('Publish the launch checklist')
      await expect(
        reviewCards.nth(1).getByRole('textbox', { name: 'Summary', exact: true })
      ).toHaveValue('Confirm the rollout owners')
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
        reviewCards.nth(0).getByRole('textbox', { name: 'Summary', exact: true })
      ).toHaveValue('Publish the launch checklist')
      await page.getByText(question, { exact: true }).scrollIntoViewIfNeeded()
      await capture('assistant-actions-desktop')
      await reviewCards.nth(0).scrollIntoViewIfNeeded()
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
      await reviewCards
        .nth(0)
        .getByRole('textbox', { name: 'Summary', exact: true })
        .fill('Publish the reviewed launch checklist')
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
      await expect(reviewCards.getByRole('textbox', { name: 'Summary', exact: true })).toHaveValue(
        'Confirm the rollout owners'
      )
      await expect(
        page.getByText('No longer waiting for review', { exact: false }).first()
      ).toBeVisible()
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
      await page.route(`${reviewUrl}*`, (route) =>
        route.request().method() === 'GET' ? route.abort('failed') : route.continue()
      )
      try {
        await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible({
          timeout: 15_000,
        })
        await expect(reviewCards).toHaveCount(0)
      } finally {
        await page.unroute(`${reviewUrl}*`)
      }
      await page.getByRole('button', { name: 'Retry', exact: true }).click()
      await expect(reviewCards).toHaveCount(2)
      await expect(
        reviewCards.nth(0).getByRole('textbox', { name: 'Summary', exact: true })
      ).toHaveValue('Review the support handoff')
      await expect(
        reviewCards.nth(1).getByRole('textbox', { name: 'Summary', exact: true })
      ).toHaveValue('Prepare the launch announcement')
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
          reviewCards.getByRole('textbox', { name: 'Summary', exact: true })
        ).toHaveValue('A later proposal that was never approved')
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
  await check('Browser runtime and HTTP responses', async () => {
    assert.deepEqual(browserErrors, [])
    assert.deepEqual(serverErrors, [])
  })
} catch (error) {
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
      { checks, browserErrors, serverErrors, httpResponses, artifactDirectory },
      null,
      2
    )
  )
}
