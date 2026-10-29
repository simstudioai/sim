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
 * Runs against a local app and disposable PostgreSQL with member Search and Access Control enabled.
 * Requires ORGANIZATION_SEARCH_E2E_BASE_URL, ORGANIZATION_SEARCH_E2E_DATABASE_URL,
 * ORGANIZATION_SEARCH_E2E_AUTH_SECRET, and ORGANIZATION_SEARCH_E2E_REPORT_PATH.
 * Verifies navigation, draft persistence, and authorized history without invoking an LLM.
 */
const logger = createLogger('OrganizationSearchE2E')
function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

const baseUrl = new URL(requiredEnvironment('ORGANIZATION_SEARCH_E2E_BASE_URL'))
assert(['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname), 'Use a local app')
assert.equal(baseUrl.protocol, 'http:')
assert.equal(baseUrl.pathname, '/')
assert(!baseUrl.username && !baseUrl.password, 'The app URL must not contain credentials')
const databaseUrl = assertDisposableTestDatabaseUrl(
  requiredEnvironment('ORGANIZATION_SEARCH_E2E_DATABASE_URL')
)
const authSecret = requiredEnvironment('ORGANIZATION_SEARCH_E2E_AUTH_SECRET')
assert(authSecret.length >= 32, 'Use a local auth secret of at least 32 characters')
const reportPath = resolve(requiredEnvironment('ORGANIZATION_SEARCH_E2E_REPORT_PATH'))
const artifactDirectory = `${reportPath}.artifacts`
const sql = postgres(databaseUrl.toString(), { max: 2 })
const userId = generateId()
const organizationId = generateId()
const otherOrganizationId = generateId()
const assistantId = generateId()
const agentId = generateId()
const deniedChatId = generateId()
const token = generateShortId()
const root = `/o/${organizationId}`
const question = 'What is the latest on the product launch?'
const answer = 'The launch checklist is complete and ready for approval.'
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const browserErrors: string[] = []
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const page = await context.newPage()
page.on('pageerror', (error) => browserErrors.push(error.message))

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
  await page.screenshot({ path: resolve(artifactDirectory, `${name}.png`) })
}

async function verifyLegacyDraft(
  mode: 'agent' | 'assistant' | undefined,
  destination: 'agent' | 'assistant',
  existingDraft = false
) {
  const legacyContext = await browser.newContext()
  await legacyContext.addCookies(await context.cookies())
  const legacyPage = await legacyContext.newPage()
  legacyPage.on('pageerror', (error) => browserErrors.push(error.message))
  const prefix = `${userId}:organization:${organizationId}:`
  const draftKey = `${prefix}${destination === 'assistant' ? 'search-assistant' : 'home'}`
  const attachment = {
    id: 'legacy-upload',
    key: `copilot/${userId}/legacy-note.txt`,
    filename: 'legacy-note.txt',
    media_type: 'text/plain',
    size: 68,
    path: `/api/files/serve/copilot/${userId}/legacy-note.txt`,
  }
  const expectedDraft = {
    text: existingDraft ? 'A newer destination draft' : 'An unsent question from before the move',
    fileAttachments: [
      existingDraft
        ? {
            ...attachment,
            id: 'new-upload',
            key: `copilot/${userId}/new-note.txt`,
            filename: 'new-note.txt',
            path: `/api/files/serve/copilot/${userId}/new-note.txt`,
          }
        : attachment,
    ],
  }
  await legacyPage.addInitScript(
    ({ prefix, draftKey, expectedDraft, attachment, existingDraft, mode, modeKey }) => {
      if (sessionStorage.getItem('legacy-draft-seeded')) return
      sessionStorage.setItem('legacy-draft-seeded', 'true')
      localStorage.setItem(
        'mothership-drafts:v1',
        JSON.stringify({
          version: 1,
          state: {
            drafts: {
              [`${prefix}new`]: {
                text: 'An unsent question from before the move',
                fileAttachments: [attachment],
              },
              ...(existingDraft ? { [draftKey]: expectedDraft } : {}),
            },
          },
        })
      )
      localStorage.setItem(
        'organization-chat-mode',
        JSON.stringify({ version: 2, state: { modes: mode ? { [modeKey]: mode } : {} } })
      )
    },
    {
      prefix,
      draftKey,
      expectedDraft,
      attachment,
      existingDraft,
      mode,
      modeKey: `${userId}:${organizationId}`,
    }
  )
  try {
    const destinationUrl = `${baseUrl.origin}${root}/${destination === 'assistant' ? 'search?mode=assistant' : 'home'}`
    await legacyPage.goto(destinationUrl)
    const input = legacyPage.getByRole('textbox', { name: 'Ask Sim' })
    await expect(input).toHaveValue(expectedDraft.text)
    if (mode) {
      await legacyPage.goto(
        `${baseUrl.origin}${root}/${destination === 'assistant' ? 'home' : 'search?mode=assistant'}`
      )
      await expect(legacyPage.getByRole('textbox', { name: 'Ask Sim' })).toHaveValue('')
      await legacyPage.goto(destinationUrl)
    }
    await expect(input).toHaveValue(expectedDraft.text)
    await input.fill('Continue the recovered draft')
    await legacyPage.reload()
    await expect(input).toHaveValue('Continue the recovered draft')
    const stored = await legacyPage.evaluate(() =>
      JSON.parse(localStorage.getItem('mothership-drafts:v1') ?? '{}')
    )
    const drafts = toRecord(toRecord(toRecord(stored).state).drafts)
    assert.deepEqual(toRecord(drafts[draftKey]).fileAttachments, expectedDraft.fileAttachments)
    assert.equal(drafts[`${prefix}new`], undefined)
  } finally {
    await legacyContext.close()
  }
}

try {
  await mkdir(artifactDirectory, { recursive: true })
  await sql.begin(async (tx) => {
    const email = `${userId}@organization-search-e2e.test`
    await tx`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
      values (${userId}, 'Taylor', ${email}, ${email}, true, now(), now())`
    await tx`insert into user_stats (id, user_id) values (${generateId()}, ${userId})`
    await tx`insert into organization (id, name, slug, created_at)
      values (${organizationId}, 'Acme', ${organizationId}, now()),
             (${otherOrganizationId}, 'Other organization', ${otherOrganizationId}, now())`
    await tx`insert into member (id, user_id, organization_id, role)
      values (${generateId()}, ${userId}, ${organizationId}, 'owner')`
    await tx`insert into session (id, token, user_id, expires_at, created_at, updated_at)
      values (${generateId()}, ${token}, ${userId}, now() + interval '1 day', now(), now())`
    for (const [id, mode, title, owner] of [
      [assistantId, 'assistant', 'Launch readiness', organizationId],
      [agentId, 'agent', 'Prepare launch checklist', organizationId],
      [deniedChatId, 'assistant', 'Other organization history', otherOrganizationId],
    ] as const) {
      await tx`insert into copilot_chats (id, user_id, organization_id, type, title, config)
        values (${id}, ${userId}, ${owner}, 'mothership', ${title},
          ${tx.json({ conversationMode: mode })})`
    }
    for (const [seq, role, content] of [
      [1, 'user', question],
      [2, 'assistant', answer],
    ] as const) {
      const messageId = generateId()
      await tx`insert into copilot_messages (id, chat_id, message_id, role, content, seq)
        values (${generateId()}, ${assistantId}, ${messageId}, ${role},
          ${tx.json({ id: messageId, role, content, timestamp: new Date().toISOString() })}, ${seq})`
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
  await check('Existing Assistant drafts move with their attachments and stay out of Home', () =>
    verifyLegacyDraft('assistant', 'assistant')
  )
  await check('Existing Home drafts and their attachments stay out of Assistant', () =>
    verifyLegacyDraft('agent', 'agent')
  )
  await check('A newer Assistant draft takes precedence over the legacy shared draft', () =>
    verifyLegacyDraft('assistant', 'assistant', true)
  )
  await check(
    'Search and Assistant preserve independent drafts across tabs and reloads',
    async () => {
      await page.goto(`${baseUrl.origin}${root}/search`)
      await expect(page.getByRole('radio', { name: 'Search', exact: true })).toBeChecked()
      const searchInput = page.getByRole('textbox', { name: 'Search your sources' })
      await searchInput.fill('Launch notes')
      await page.getByRole('radio', { name: 'Assistant', exact: true }).click()
      const assistantInput = page.getByRole('textbox', { name: 'Ask Sim' })
      await expect(assistantInput).toHaveValue('')
      await assistantInput.fill('Summarize launch readiness')
      await page.getByRole('radio', { name: 'Search', exact: true }).click()
      await expect(searchInput).toHaveValue('Launch notes')
      await page.getByRole('radio', { name: 'Assistant', exact: true }).click()
      await expect(assistantInput).toHaveValue('Summarize launch readiness')
      await expect(page).toHaveURL(
        (url) => url.pathname === `${root}/search` && url.searchParams.get('mode') === 'assistant'
      )
      await page.reload()
      await expect(page.getByRole('radio', { name: 'Assistant', exact: true })).toBeChecked()
      await expect(assistantInput).toHaveValue('Summarize launch readiness')
    }
  )
  await check(
    'Traditional search submits the organization query and keeps results in Search',
    async () => {
      await page.getByRole('radio', { name: 'Search', exact: true }).click()
      const responsePromise = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/knowledge/search' &&
          response.request().method() === 'POST'
      )
      await page.getByRole('textbox', { name: 'Search your sources' }).press('Enter')
      const response = await responsePromise
      assert.equal(response.status(), 200)
      const body = toRecord(response.request().postDataJSON())
      assert.equal(body.organizationId, organizationId)
      assert.equal(body.query, 'Launch notes')
      await expect(page.getByText('Search found no results.', { exact: true })).toBeVisible()
      await expect(page).toHaveURL(
        (url) => url.pathname === `${root}/search` && url.searchParams.get('q') === 'Launch notes'
      )
      await capture('search-results-desktop')
    }
  )
  await check('Home has its own chat draft and no Build/Search picker', async () => {
    await page.goto(`${baseUrl.origin}${root}/home`)
    await expect(page.getByRole('textbox', { name: 'Ask Sim' })).toHaveValue('')
    await expect(page.getByRole('combobox', { name: 'Conversation mode' })).toHaveCount(0)
    await page.getByRole('textbox', { name: 'Ask Sim' }).fill('Prepare a launch checklist')
    await capture('home-desktop')
    await page.goto(`${baseUrl.origin}${root}/search?mode=assistant`)
    await expect(page.getByRole('textbox', { name: 'Ask Sim' })).toHaveValue(
      'Summarize launch readiness'
    )
  })
  await check('Saved assistant history opens inside Search and starts a fresh search', async () => {
    await page.goto(`${baseUrl.origin}${root}/search/chat/${assistantId}`)
    await expect(page.getByRole('radio', { name: 'Assistant', exact: true })).toBeChecked()
    await expect(page.getByText(answer, { exact: true })).toBeVisible()
    await capture('assistant-conversation-desktop')
    await page.getByRole('button', { name: 'New search', exact: true }).click()
    await expect(page).toHaveURL(`${baseUrl.origin}${root}/search`)
    await expect(page.getByRole('radio', { name: 'Search', exact: true })).toBeChecked()
  })
  await check('Existing assistant bookmarks redirect into Search', async () => {
    await page.goto(`${baseUrl.origin}${root}/chat/${assistantId}`)
    await expect(page).toHaveURL(`${baseUrl.origin}${root}/search/chat/${assistantId}`)
    await expect(page.getByText(answer, { exact: true })).toBeVisible()
  })
  await check('Search URLs cannot change an agent conversation into an assistant', async () => {
    await page.goto(`${baseUrl.origin}${root}/search/chat/${agentId}`)
    await expect(page).toHaveURL(`${baseUrl.origin}${root}/chat/${agentId}`)
    await expect(page.getByRole('radiogroup', { name: 'Search mode' })).toHaveCount(0)
  })
  await check('Assistant history rejects a chat from another organization', async () => {
    await page.goto(`${baseUrl.origin}${root}/search/chat/${deniedChatId}`)
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    const response = await page.request.get(
      `${baseUrl.origin}/api/mothership/chats/${deniedChatId}`
    )
    assert.equal(response.status(), 404)
  })
  await check('Both search modes fit desktop and 320px/390px phones', async () => {
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
      for (const mode of ['search', 'assistant'] as const) {
        await page.goto(`${baseUrl.origin}${root}/search?mode=${mode}`)
        await expect(
          page.getByRole('radio', { name: mode === 'search' ? 'Search' : 'Assistant', exact: true })
        ).toBeChecked()
        await expect(
          page.getByRole('textbox', { name: mode === 'search' ? 'Search your sources' : 'Ask Sim' })
        ).toBeVisible()
        const dimensions = await page.evaluate(() => ({
          width: innerWidth,
          contentWidth: document.documentElement.scrollWidth,
        }))
        assert(
          dimensions.contentWidth <= dimensions.width,
          `Horizontal overflow in ${mode} at ${width}px`
        )
        await capture(`${mode}-${width}`)
      }
    }
  })
  await check(
    'Search-only members can reopen assistant history without access to Home chat',
    async () => {
      await sql`insert into permission_group (id, organization_id, name, config, created_by, is_default)
      values (${generateId()}, ${organizationId}, 'Search only',
        ${sql.json({ disableWorkspaceCreation: true })}, ${userId}, true)`
      await page.goto(`${baseUrl.origin}${root}/home`)
      await expect(page).toHaveURL(`${baseUrl.origin}${root}/search`)
      await page.goto(`${baseUrl.origin}${root}/search/chat/${assistantId}`)
      await expect(page.getByText(answer, { exact: true })).toBeVisible()
    }
  )
  await check('Search-only members recover legacy drafts without a remembered mode', () =>
    verifyLegacyDraft(undefined, 'assistant')
  )
  await check('The UI completes without browser runtime errors', async () => {
    assert.deepEqual(browserErrors, [])
  })
} catch (error) {
  logger.error('Organization Search E2E failed', { error: getErrorMessage(error) })
  await capture('failure').catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
  try {
    await sql.begin(async (tx) => {
      await tx`delete from workspace where owner_id = ${userId}`
      await tx`delete from project where owner_id = ${userId}`
      await tx`delete from organization where id in (${organizationId}, ${otherOrganizationId})`
      await tx`delete from "user" where id = ${userId}`
    })
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
  await writeFile(reportPath, JSON.stringify({ checks, browserErrors, artifactDirectory }, null, 2))
}
