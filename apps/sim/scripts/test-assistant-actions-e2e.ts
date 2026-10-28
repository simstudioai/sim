import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId, generateShortId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { makeSignature } from 'better-auth/crypto'
import postgres from 'postgres'

/**
 * Runs against a local app and disposable PostgreSQL with member Search, Connected Accounts, and Access Control enabled.
 * Requires ASSISTANT_ACTIONS_E2E_BASE_URL, ASSISTANT_ACTIONS_E2E_DATABASE_URL,
 * ASSISTANT_ACTIONS_E2E_AUTH_SECRET, and ASSISTANT_ACTIONS_E2E_REPORT_PATH.
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
const firstCallId = generateId()
const secondCallId = generateId()
const token = generateShortId()
const root = `/o/${organizationId}`
const question = 'Create the two launch follow-up tickets in Jira.'
const answer = 'Review the two Jira issues before I create them.'
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const browserErrors: string[] = []
const serverErrors: { path: string; status: number }[] = []
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
page.on('pageerror', (error) => browserErrors.push(error.message))
page.on('response', (response) => {
  const url = new URL(response.url())
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
      values (${groupId}, ${organizationId}, ${generateId()}, 'Personal Jira', ${tx.json(['jira', 'salesforce'].map((provider) => ({ id: provider, provider, label: provider, authorizationAppId: 'fixture', requiredScopes: [], scopeVersion: 1, required: false, status: 'active' })))})`
    await tx`insert into resource_policy (id, organization_id, resource_type, resource_id, document, created_by, updated_by)
      values (${generateId()}, ${organizationId}, 'credential_group', ${groupId}, ${tx.json({ version: 2, resource: { type: 'credential_group', id: groupId }, statements: [] })}, ${userId}, ${userId})`
    await tx`insert into credential_group_enrollment (id, credential_group_id, user_id, email, status, invitation_token_hash, invitation_expires_at, invited_at)
      values (${enrollmentId}, ${groupId}, ${userId}, ${email}, 'completed', ${enrollmentId.replaceAll('-', '').repeat(2)}, now() + interval '1 day', now())`
    await tx`insert into credential (id, organization_id, type, created_by, display_name, provider_id, credential_group_enrollment_id, credential_group_option_id, managed_oauth_status, managed_oauth_scope_version, granted_scopes, provider_subject_id, authorization_app_id, encrypted_oauth_token_set, granted_at)
      values (${credentialId}, ${organizationId}, 'managed_oauth', ${userId}, 'taylor@acme.example', 'jira', ${enrollmentId}, 'jira', 'active', 1, '{}'::text[], ${userId}, 'fixture', 'fixture-not-a-provider-token', now())`
    await tx`insert into credential (id, organization_id, type, created_by, display_name, provider_id, credential_group_enrollment_id, credential_group_option_id, managed_oauth_status, managed_oauth_scope_version, granted_scopes, provider_subject_id, authorization_app_id, encrypted_oauth_token_set, granted_at)
      values (${nativeCredentialId}, ${organizationId}, 'managed_oauth', ${userId}, 'taylor@acme.example', 'salesforce', ${enrollmentId}, 'salesforce', 'active', 1, '{}'::text[], ${userId}, 'fixture', 'fixture-not-a-provider-token', now())`
    await tx`insert into copilot_chats (id, user_id, organization_id, type, title, config)
      values (${assistantId}, ${userId}, ${organizationId}, 'mothership', 'Launch follow-up', ${tx.json({ conversationMode: 'assistant' })})`
    for (const [seq, role, content] of [
      [1, 'user', question],
      [2, 'assistant', answer],
    ] as const) {
      const messageId = generateId()
      await tx`insert into copilot_messages (id, chat_id, message_id, role, content, seq)
        values (${generateId()}, ${assistantId}, ${messageId}, ${role}, ${tx.json({ id: messageId, role, content, timestamp: new Date().toISOString() })}, ${seq})`
    }
    await tx`insert into copilot_runs (id, chat_id, user_id, organization_id, execution_id, stream_id, tool_execution_version, status)
      values (${runId}, ${assistantId}, ${userId}, ${organizationId}, ${generateId()}, ${generateId()}, 3, 'paused_waiting_for_tool')`
    for (const [id, summary] of [
      [firstCallId, 'Publish the launch checklist'],
      [secondCallId, 'Confirm the rollout owners'],
    ] as const) {
      const args = {
        credential: credentialId,
        domain: 'acme.atlassian.net',
        projectId: 'LAUNCH',
        issueType: 'Task',
        summary,
        description: 'Confirm the final owner and target date before the customer announcement.',
      }
      await tx`insert into copilot_async_tool_calls (run_id, tool_call_id, tool_name, executable_name, args, assistant_action, execution_retryable, permission_requested_at)
        values (${runId}, ${id}, 'jira_write', 'jira_write', ${tx.json(args)}, ${tx.json({ credentialId, operationVersion: 1, effect: 'write' })}, false, now())`
    }
  })
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
    const permissions = page.locator(
      `a[href="${root}/integrations/accounts/${nativeCredentialId}"]`
    )
    await expect(permissions).toBeVisible({ timeout: 180_000 })
    await permissions.click()
    const policy = page.getByRole('radiogroup', { name: 'Create Task in Salesforce permission' })
    await expect(policy).toBeVisible({ timeout: 180_000 })
    await expect(policy.getByRole('radio', { name: 'Ask', exact: true })).toBeChecked()
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
  await check('The Assistant groups exact proposed actions in one review', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(`${baseUrl.origin}${root}/search/chat/${assistantId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 180_000,
    })
    await expect(page.getByText('2 actions to review')).toBeVisible({ timeout: 180_000 })
    await capture('assistant-actions-desktop')
    await page.getByRole('button', { name: 'Review', exact: true }).click()
    const modal = page.getByRole('dialog', { name: 'Review Assistant actions' })
    await expect(modal).toBeVisible()
    await expect(modal.getByRole('textbox', { name: 'Project', exact: true }).first()).toHaveValue(
      'LAUNCH'
    )
    await expect(
      modal.getByRole('textbox', { name: 'Jira site', exact: true }).first()
    ).toHaveValue('acme.atlassian.net')
    await capture('action-review-desktop')
    await page.setViewportSize({ width: 390, height: 844 })
    await capture('action-review-mobile')
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'Mobile review overflows horizontally'
    )
  })
  await check(
    'An edited approval and a cancellation affect only their saved proposals',
    async () => {
      const modal = page.getByRole('dialog', { name: 'Review Assistant actions' })
      await modal
        .getByRole('textbox', { name: 'Summary', exact: true })
        .first()
        .fill('Publish the reviewed launch checklist')
      const approval = page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          response.url().endsWith(`/actions/${firstCallId}`),
        { timeout: 180_000 }
      )
      await modal.getByRole('button', { name: 'Allow', exact: true }).first().click()
      const approvalResponse = await approval
      assert.equal(approvalResponse.status(), 200, await approvalResponse.text())
      await expect(modal.getByRole('textbox', { name: 'Summary', exact: true })).toHaveCount(1)
      await modal.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(modal.getByText('No actions are waiting for review.')).toBeVisible()
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
  try {
    await sql`delete from workspace where owner_id = ${userId}`
    await sql`delete from project where owner_id = ${userId}`
    await sql`delete from organization where id in (${organizationId},${otherOrganizationId})`
    await sql`delete from "user" where id = ${userId}`
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
  }
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(
    reportPath,
    JSON.stringify({ checks, browserErrors, serverErrors, artifactDirectory }, null, 2)
  )
}
