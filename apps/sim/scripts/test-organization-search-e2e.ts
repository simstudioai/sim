import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { type BrowserContext, chromium, expect } from '@playwright/test'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createLogger } from '@sim/logger'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { toStringOrNull } from '@sim/utils/coerce'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId, generateShortId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { makeSignature } from 'better-auth/crypto'
import postgres from 'postgres'
import { searchWorkspaceKnowledgeContract } from '@/lib/api/contracts/knowledge/search'
import { type CreateEventInput, createEvent } from '@/lib/mothership/request/session/event'

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
const DIAGNOSTIC_LIMITS = { samples: 40, text: 2000, stack: 8000, templates: 8 } as const
interface BrowserErrorSample {
  stage: string
  url: string
  message: string
  stack: string
  digest: string | null
  templates: { digest: string | null; message: string | null }[]
  count: number
}
const browserErrors: string[] = []
const browserErrorSamples: BrowserErrorSample[] = []
const browserErrorEvents: BrowserErrorSample[] = []
const documentResponses: {
  stage: string
  url: string
  status: number
  headers: Record<string, string>
}[] = []
let deniedDocument: {
  url: string
  status: number
  bytes: number
  suspenseTemplates: string[]
  suspenseMarkers: string[]
  suspenseInstructions: string[]
  robots: string[]
} | null = null
let browserErrorCount = 0
let browserErrorEventCount = 0
let currentCheck = 'Setup'

function recordErrorSample(
  samples: BrowserErrorSample[],
  sample: Omit<BrowserErrorSample, 'count'>
) {
  const previous = samples.find(
    (entry) =>
      entry.stage === sample.stage &&
      entry.url === sample.url &&
      entry.message === sample.message &&
      entry.stack === sample.stack &&
      entry.digest === sample.digest
  )
  if (previous) previous.count += 1
  else if (samples.length < DIAGNOSTIC_LIMITS.samples) samples.push({ ...sample, count: 1 })
}

async function observeBrowserContext(observedContext: BrowserContext) {
  await observedContext.exposeBinding(
    'recordOrganizationSearchError',
    (_source, payload: unknown) => {
      const event = toRecord(payload)
      browserErrorEventCount += 1
      recordErrorSample(browserErrorEvents, {
        stage: currentCheck,
        url: truncate(toStringOrNull(event.url) ?? '', DIAGNOSTIC_LIMITS.text),
        message: truncate(toStringOrNull(event.message) ?? '', DIAGNOSTIC_LIMITS.text),
        stack: truncate(toStringOrNull(event.stack) ?? '', DIAGNOSTIC_LIMITS.stack),
        digest: toStringOrNull(event.digest)?.slice(0, DIAGNOSTIC_LIMITS.text) ?? null,
        templates: Array.isArray(event.templates)
          ? event.templates.slice(0, DIAGNOSTIC_LIMITS.templates).map((value: unknown) => {
              const template = toRecord(value)
              return {
                digest: toStringOrNull(template.digest)?.slice(0, DIAGNOSTIC_LIMITS.text) ?? null,
                message: toStringOrNull(template.message)?.slice(0, DIAGNOSTIC_LIMITS.text) ?? null,
              }
            })
          : [],
      })
    }
  )
  await observedContext.addInitScript((limits) => {
    const report = (
      window as typeof window & {
        recordOrganizationSearchError: (sample: unknown) => Promise<void>
      }
    ).recordOrganizationSearchError
    window.addEventListener('error', (event) => {
      const message: unknown = event.error?.message
      const stack: unknown = event.error?.stack
      const digest: unknown = event.error?.digest
      void report({
        url: location.href.slice(0, limits.text),
        message: (typeof message === 'string' ? message : event.message).slice(0, limits.text),
        stack: typeof stack === 'string' ? stack.slice(0, limits.stack) : '',
        digest: typeof digest === 'string' ? digest.slice(0, limits.text) : null,
        templates: Array.from(document.querySelectorAll('template[data-dgst], template[data-msg]'))
          .slice(0, limits.templates)
          .map((template) => ({
            digest: template.getAttribute('data-dgst')?.slice(0, limits.text) ?? null,
            message: template.getAttribute('data-msg')?.slice(0, limits.text) ?? null,
          })),
      }).catch(() => {})
    })
  }, DIAGNOSTIC_LIMITS)
  observedContext.on('page', (observedPage) => {
    observedPage.on('pageerror', (error) => {
      browserErrorCount += 1
      const message = truncate(error.message, DIAGNOSTIC_LIMITS.text)
      if (!browserErrors.includes(message) && browserErrors.length < DIAGNOSTIC_LIMITS.samples) {
        browserErrors.push(message)
      }
      recordErrorSample(browserErrorSamples, {
        stage: currentCheck,
        url: truncate(observedPage.url(), DIAGNOSTIC_LIMITS.text),
        message,
        stack: truncate(error.stack ?? '', DIAGNOSTIC_LIMITS.stack),
        digest: null,
        templates: [],
      })
    })
    observedPage.on('response', (response) => {
      if (
        response.request().resourceType() !== 'document' ||
        response.frame() !== observedPage.mainFrame() ||
        documentResponses.length >= DIAGNOSTIC_LIMITS.samples
      ) {
        return
      }
      const headers: Record<string, string> = {}
      for (const name of [
        'content-type',
        'cache-control',
        'x-nextjs-cache',
        'x-nextjs-prerender',
        'x-nextjs-stale-time',
        'x-nextjs-postponed',
        'x-matched-path',
      ]) {
        const value = response.headers()[name]
        if (value) headers[name] = truncate(value, DIAGNOSTIC_LIMITS.text)
      }
      documentResponses.push({
        stage: currentCheck,
        url: truncate(response.url(), DIAGNOSTIC_LIMITS.text),
        status: response.status(),
        headers,
      })
    })
  })
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
await observeBrowserContext(context)
const page = await context.newPage()

async function check(name: string, run: () => Promise<void>) {
  currentCheck = name
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
  await observeBrowserContext(legacyContext)
  await legacyContext.addCookies(await context.cookies())
  const legacyPage = await legacyContext.newPage()
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
      await expect(
        page
          .getByRole('navigation', { name: 'Search views' })
          .getByRole('button', { name: 'Search', exact: true })
      ).toHaveAttribute('aria-current', 'page')
      const searchInput = page.getByRole('textbox', { name: 'Search your sources' })
      await searchInput.fill('Launch notes')
      await page
        .getByRole('navigation', { name: 'Search views' })
        .getByRole('button', { name: 'Assistant', exact: true })
        .click()
      const assistantInput = page.getByRole('textbox', { name: 'Ask Sim' })
      await expect(assistantInput).toHaveValue('')
      await assistantInput.fill('Summarize launch readiness')
      await page
        .getByRole('navigation', { name: 'Search views' })
        .getByRole('button', { name: 'Search', exact: true })
        .click()
      await expect(searchInput).toHaveValue('Launch notes')
      await page
        .getByRole('navigation', { name: 'Search views' })
        .getByRole('button', { name: 'Assistant', exact: true })
        .click()
      await expect(assistantInput).toHaveValue('Summarize launch readiness')
      await expect(page).toHaveURL(
        (url) => url.pathname === `${root}/search` && url.searchParams.get('mode') === 'assistant'
      )
      await page.reload()
      await expect(
        page
          .getByRole('navigation', { name: 'Search views' })
          .getByRole('button', { name: 'Assistant', exact: true })
      ).toHaveAttribute('aria-current', 'page')
      await expect(assistantInput).toHaveValue('Summarize launch readiness')
    }
  )
  await check(
    'Traditional search submits the organization query and keeps results in Search',
    async () => {
      await page
        .getByRole('navigation', { name: 'Search views' })
        .getByRole('button', { name: 'Search', exact: true })
        .click()
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
  await check('Changing Search views preserves the conversation, filters, and draft', async () => {
    const path = `${root}/search/chat/${assistantId}`
    await page.goto(`${baseUrl.origin}${path}?q=Launch&source=slack&updated=7d`)
    const input = page.getByRole('textbox', { name: 'Ask Sim' })
    await input.fill('Which owners still need to reply?')
    await page
      .getByRole('navigation', { name: 'Search views' })
      .getByRole('button', { name: 'Search', exact: true })
      .click()
    await expect(page).toHaveURL(
      (url) => url.pathname === path && url.searchParams.get('mode') === 'search'
    )
    await page.reload()
    await page
      .getByRole('navigation', { name: 'Search views' })
      .getByRole('button', { name: 'Assistant', exact: true })
      .click()
    await expect(page.getByText(answer, { exact: true })).toBeVisible()
    await expect(input).toHaveValue('Which owners still need to reply?')
    const restored = new URL(page.url())
    assert.equal(restored.pathname, path)
    assert.equal(restored.searchParams.get('q'), 'Launch')
    assert.equal(restored.searchParams.get('source'), 'slack')
    assert.equal(restored.searchParams.get('updated'), '7d')
  })
  await check('New chat stays in Assistant and starts with a fresh draft', async () => {
    await page.goto(`${baseUrl.origin}${root}/search/chat/${assistantId}`)
    await expect(
      page
        .getByRole('navigation', { name: 'Search views' })
        .getByRole('button', { name: 'Assistant', exact: true })
    ).toHaveAttribute('aria-current', 'page')
    await expect(page.getByText(answer, { exact: true })).toBeVisible()
    await capture('assistant-conversation-desktop')
    await page.getByRole('button', { name: 'New chat', exact: true }).click()
    await expect(page).toHaveURL(`${baseUrl.origin}${root}/search?mode=assistant`)
    await expect(page.getByRole('textbox', { name: 'Ask Sim' })).toHaveValue('')
    await expect(
      page
        .getByRole('navigation', { name: 'Search views' })
        .getByRole('button', { name: 'Assistant', exact: true })
    ).toHaveAttribute('aria-current', 'page')
  })
  await check(
    'Admission, New chat and repeated summaries preserve mode, context and drafts',
    async () => {
      const releaseAdmission = createDeferred<void>()
      let heldAdmission: Promise<void> | undefined
      let includeAdmissionHeader = true
      const posts: Record<string, unknown>[] = []
      const createdChatIds: string[] = []
      const chatEndpoint = `${baseUrl.origin}/api/mothership/chat`
      const searchEndpoint = `${baseUrl.origin}/api/knowledge/search`
      const documentId = generateId()
      const searchRequests: Record<string, unknown>[] = []
      const searchBody = searchWorkspaceKnowledgeContract.body
      assert(searchBody)
      await page.route(searchEndpoint, async (route) => {
        const body = searchBody.parse(route.request().postDataJSON())
        searchRequests.push(body)
        await route.fulfill({
          json: searchWorkspaceKnowledgeContract.response.schema.parse({
            success: true,
            data: {
              query: body.query,
              retrieval: { status: 'complete', timedOutLegs: [] },
              results: [
                {
                  documentId,
                  knowledgeBaseId: generateId(),
                  knowledgeBaseName: 'Team documents',
                  documentName: 'Launch checklist',
                  sourceUrl: 'https://example.invalid/launch',
                  connectorType: 'slack',
                  sourceModifiedAt: new Date().toISOString(),
                  author: null,
                  content: 'The launch checklist is ready for review.',
                  chunkIndex: 0,
                  similarity: 1,
                },
              ],
            },
          }),
        })
      })
      await page.route(chatEndpoint, async (route) => {
        if (route.request().method() !== 'POST') return route.continue()
        const body = toRecord(route.request().postDataJSON())
        const number = posts.push(body)
        if (number === 1) await releaseAdmission.promise
        await heldAdmission
        const chatId = toStringOrNull(body.chatId) ?? generateId()
        const streamId = toStringOrNull(body.userMessageId)
        assert(streamId)
        assert.equal(body.organizationId, organizationId)
        assert.equal(body.mode, 'assistant')
        createdChatIds.push(chatId)
        const responseText = `Deterministic assistant response ${number}.`
        const requestId = generateId()
        await sql`insert into copilot_chats (id, user_id, organization_id, type, title, config)
        values (${chatId}, ${userId}, ${organizationId}, 'mothership', 'Navigation test', ${sql.json({ conversationMode: 'assistant' })}) on conflict (id) do nothing`
        for (const message of [
          { id: streamId, role: 'user', content: String(body.message) },
          { id: generateId(), role: 'assistant', content: responseText },
        ]) {
          await sql`insert into copilot_messages (id, chat_id, message_id, role, stream_id, content, seq)
          values (${generateId()}, ${chatId}, ${message.id}, ${message.role}, ${streamId}, ${sql.json({ ...message, requestId, timestamp: new Date().toISOString() })}, (select coalesce(max(seq), 0) + 1 from copilot_messages where chat_id = ${chatId}))`
        }
        const base = { chatId, streamId, requestId }
        const events: CreateEventInput[] = [
          { ...base, cursor: '1', seq: 1, type: 'session', payload: { kind: 'chat', chatId } },
          {
            ...base,
            cursor: '2',
            seq: 2,
            type: 'text',
            payload: { channel: 'assistant', text: responseText, textOffset: 0 },
          },
          {
            ...base,
            cursor: '3',
            seq: 3,
            type: 'complete',
            payload: { status: 'complete', textLength: responseText.length },
          },
        ]
        await route.fulfill({
          status: 200,
          headers: {
            'content-type': 'text/event-stream',
            ...(includeAdmissionHeader ? { 'x-mothership-chat-id': chatId } : {}),
          },
          body: `${events.map((event) => `data: ${JSON.stringify(createEvent(event))}\n\n`).join('')}data: [DONE]\n\n`,
        })
      })
      try {
        await page.goto(`${baseUrl.origin}${root}/search?q=Launch&source=slack&updated=7d`)
        const navigation = page.getByRole('navigation', { name: 'Search views' })
        await navigation.getByRole('button', { name: 'Assistant', exact: true }).click()
        const composer = page.getByRole('textbox', { name: 'Ask Sim' })
        await composer.fill('A new conversation before admission')
        await composer.press('Enter')
        await expect.poll(() => posts.length).toBe(1)
        await page.goBack()
        await expect(
          navigation.getByRole('button', { name: 'Search', exact: true })
        ).toHaveAttribute('aria-current', 'page')
        releaseAdmission.resolve()
        await expect(page).toHaveURL(
          (url) =>
            url.pathname === `${root}/search/chat/${createdChatIds[0]}` &&
            url.searchParams.get('mode') === 'search'
        )
        assert.equal(new URL(page.url()).searchParams.get('q'), 'Launch')
        assert.equal(new URL(page.url()).searchParams.get('source'), 'slack')
        assert.equal(new URL(page.url()).searchParams.get('updated'), '7d')
        await expect(
          page.getByText('Deterministic assistant response 1.', { exact: true })
        ).not.toBeVisible()
        await navigation.getByRole('button', { name: 'Assistant', exact: true }).click()
        await expect(
          page.getByText('Deterministic assistant response 1.', { exact: true })
        ).toBeVisible()
        await composer.fill('An unsent follow-up')
        await page.getByRole('button', { name: 'New chat', exact: true }).click()
        await expect(page).toHaveURL(`${baseUrl.origin}${root}/search?mode=assistant`)
        await expect(composer).toHaveValue('')
        await composer.fill('A distinct new conversation')
        await composer.press('Enter')
        await expect(
          page.getByText('Deterministic assistant response 2.', { exact: true })
        ).toBeVisible()
        assert.equal(posts.length, 2)
        assert.equal(posts[1]?.createNewChat, true)
        assert.equal(posts[1]?.chatId, undefined)
        assert.notEqual(createdChatIds[0], createdChatIds[1])
        await expect(page).toHaveURL(
          (url) => url.pathname === `${root}/search/chat/${createdChatIds[1]}`
        )
        await page.reload()
        await expect(
          page.getByText('Deterministic assistant response 2.', { exact: true })
        ).toBeVisible()
        await expect(
          page.getByText('Deterministic assistant response 1.', { exact: true })
        ).toHaveCount(0)
        await capture('assistant-new-chat-after-admission')
        const summaryStartedAt = Date.now()
        await page.goto(`${baseUrl.origin}${root}/search?q=Launch&source=slack&updated=7d`)
        await page
          .getByRole('button', { name: 'Actions for Launch checklist', exact: true })
          .click()
        await page.getByRole('menuitem', { name: 'Summarize', exact: true }).click()
        await expect(
          page.getByText('Deterministic assistant response 3.', { exact: true })
        ).toBeVisible()
        const summaryChatId = createdChatIds[2]
        assert.equal(posts[2]?.createNewChat, true)
        assert.equal(posts[2]?.assistantSearchLevel, 'fast')
        const { modifiedAfter: firstCutoff, ...firstSummaryFilters } = toRecord(
          posts[2]?.assistantSearch
        )
        const { modifiedAfter: searchCutoff, ...searchFilters } = toRecord(
          searchRequests.at(-1)?.filters
        )
        assert.equal(searchFilters.source, 'slack')
        assert.deepEqual(firstSummaryFilters, { ...searchFilters, documentIds: [documentId] })
        assert.equal(typeof firstCutoff, 'string')
        assert(Date.parse(String(firstCutoff)) >= summaryStartedAt - 7 * 24 * 60 * 60 * 1000)
        assert(Date.parse(String(firstCutoff)) <= Date.now() - 7 * 24 * 60 * 60 * 1000)
        await composer.fill('Keep this unsent draft')
        await navigation.getByRole('button', { name: 'Search', exact: true }).click()
        await page
          .getByRole('button', { name: 'Actions for Launch checklist', exact: true })
          .click()
        await page.getByRole('menuitem', { name: 'Summarize', exact: true }).click()
        await expect(
          page.getByText('Deterministic assistant response 4.', { exact: true })
        ).toBeVisible()
        assert.equal(posts.length, 4)
        assert.equal(posts[3]?.chatId, summaryChatId)
        assert.equal(posts[3]?.createNewChat, false)
        const { modifiedAfter: repeatedCutoff, ...repeatedSummaryFilters } = toRecord(
          posts[3]?.assistantSearch
        )
        assert.deepEqual(repeatedSummaryFilters, firstSummaryFilters)
        assert.equal(typeof repeatedCutoff, 'string')
        assert(Date.parse(String(repeatedCutoff)) >= Date.parse(String(firstCutoff)))
        assert(Date.parse(String(repeatedCutoff)) <= Date.now() - 7 * 24 * 60 * 60 * 1000)
        await expect(composer).toHaveValue('Keep this unsent draft')
        await capture('assistant-repeat-summary-preserves-draft')
        for (const selectedMode of ['search', 'assistant'] as const) {
          includeAdmissionHeader = selectedMode === 'search'
          await page.goto(`${baseUrl.origin}${root}/search?mode=assistant&q=Launch&source=slack`)
          await composer.fill(`Preserve the pending ${selectedMode} selection`)
          const admission = createDeferred<void>()
          heldAdmission = admission.promise
          const requestNumber = posts.length + 1
          try {
            await composer.press('Enter')
            await expect.poll(() => posts.length).toBe(requestNumber)
            if (selectedMode === 'assistant') {
              await navigation.getByRole('button', { name: 'Search', exact: true }).click()
              await expect(page).toHaveURL((url) => url.searchParams.get('mode') === 'search')
            }
            await page.clock.pauseAt(new Date(Date.now() + 100))
            const selected = navigation.getByRole('button', {
              name: selectedMode === 'assistant' ? 'Assistant' : 'Search',
              exact: true,
            })
            await selected.click({ force: true })
            await expect(selected).toHaveAttribute('aria-current', 'page')
            assert.notEqual(new URL(page.url()).searchParams.get('mode'), selectedMode)
            admission.resolve()
            await expect(page).toHaveURL(
              (url) =>
                url.pathname === `${root}/search/chat/${createdChatIds.at(-1)}` &&
                url.searchParams.get('mode') === selectedMode
            )
            assert.equal(new URL(page.url()).searchParams.get('source'), 'slack')
          } finally {
            admission.resolve()
            heldAdmission = undefined
            await page.clock.resume()
          }
        }
      } finally {
        releaseAdmission.resolve()
        await page.unroute(chatEndpoint)
        await page.unroute(searchEndpoint)
      }
    }
  )
  await check('Existing assistant bookmarks redirect into Search', async () => {
    await page.goto(`${baseUrl.origin}${root}/chat/${assistantId}`)
    await expect(page).toHaveURL(`${baseUrl.origin}${root}/search/chat/${assistantId}`)
    await expect(page.getByText(answer, { exact: true })).toBeVisible()
  })
  await check(
    'Search protects edits during hydration and restores the prior draft on Back',
    async () => {
      const releaseScripts = createDeferred<void>()
      const scripts = '**/_next/static/**/*.js'
      await page.route(scripts, async (route) => {
        await releaseScripts.promise
        await route.continue()
      })
      const input = page.getByRole('textbox', { name: 'Search your sources' })
      try {
        await page.goto(`${baseUrl.origin}${root}/search?q=Launch`, { waitUntil: 'commit' })
        await expect(input).toBeVisible()
        await expect(input).toBeDisabled()
        await expect(page.getByLabel('Search', { exact: true })).toBeDisabled()
      } finally {
        releaseScripts.resolve()
        await page.unrouteAll({ behavior: 'wait' })
        await page.waitForLoadState()
      }
      await expect(input).toBeFocused()
      await input.fill('Edited launch query')
      await expect(input).toHaveValue('Edited launch query')
      await page.getByRole('button', { name: 'New search', exact: true }).click()
      await expect(page).toHaveURL(`${baseUrl.origin}${root}/search`)
      await expect(input).toHaveValue('')
      await page.goBack()
      await expect(input).toHaveValue('Edited launch query')
      assert.equal(new URL(page.url()).searchParams.get('q'), 'Launch')
    }
  )
  await check('Search URLs cannot change an agent conversation into an assistant', async () => {
    await page.goto(`${baseUrl.origin}${root}/search/chat/${agentId}`)
    await expect(page).toHaveURL(`${baseUrl.origin}${root}/chat/${agentId}`)
    await expect(page.getByRole('navigation', { name: 'Search views' })).toHaveCount(0)
  })
  await check('Assistant history rejects a chat from another organization', async () => {
    const documentResponse = await page.goto(`${baseUrl.origin}${root}/search/chat/${deniedChatId}`)
    assert(documentResponse, 'The denied chat navigation must return a document')
    const html = await documentResponse.text()
    deniedDocument = {
      url: documentResponse.url(),
      status: documentResponse.status(),
      bytes: new TextEncoder().encode(html).byteLength,
      suspenseTemplates: (html.match(/<template\b[^>]*>/g) ?? [])
        .slice(0, DIAGNOSTIC_LIMITS.templates)
        .map((tag) => truncate(tag, DIAGNOSTIC_LIMITS.text)),
      suspenseMarkers: (html.match(/<!--\/?\$[^>]*-->/g) ?? [])
        .slice(0, DIAGNOSTIC_LIMITS.samples)
        .map((marker) => truncate(marker, DIAGNOSTIC_LIMITS.text)),
      suspenseInstructions: (html.match(/\$(?:RX|RC)\([^<]*?\)/g) ?? [])
        .slice(0, DIAGNOSTIC_LIMITS.templates)
        .map((instruction) => truncate(instruction, DIAGNOSTIC_LIMITS.text)),
      robots: (html.match(/<meta\b[^>]*>/g) ?? [])
        .filter((tag) => /name=["']robots["']/.test(tag))
        .slice(0, DIAGNOSTIC_LIMITS.templates)
        .map((tag) => truncate(tag, DIAGNOSTIC_LIMITS.text)),
    }
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
          page
            .getByRole('navigation', { name: 'Search views' })
            .getByRole('button', { name: mode === 'search' ? 'Search' : 'Assistant', exact: true })
        ).toHaveAttribute('aria-current', 'page')
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
    'Search keeps results usable through partial coverage and a failed request',
    async () => {
      await page.setViewportSize({ width: 1440, height: 1000 })
      const samples = [
        {
          documentId: 'launch-brief',
          documentName: 'Launch brief',
          connectorType: 'google_drive',
          knowledgeBaseName: 'Google Drive',
          sourceUrl: 'https://docs.example.test/launch',
          content: 'The launch checklist is complete. Final owner sign-off is due Friday.',
        },
        {
          documentId: 'launch-readiness',
          documentName: 'Launch readiness',
          connectorType: 'confluence',
          knowledgeBaseName: 'Confluence',
          sourceUrl: 'https://wiki.example.test/launch',
          content: 'Engineering validation is complete. The support handoff is still in progress.',
        },
      ].map((sample) => ({
        ...sample,
        knowledgeBaseId: 'preview-source',
        author: 'Taylor',
        sourceModifiedAt: '2026-10-28T18:30:00.000Z',
        chunkIndex: 0,
        similarity: 0.9,
      }))
      let unavailable = false
      let partial = false
      const searchRoute = '**/api/knowledge/search'
      await page.route(searchRoute, async (route) => {
        if (unavailable) {
          await route.fulfill({ status: 503, json: { error: 'Search is temporarily unavailable' } })
          return
        }
        const body = toRecord(route.request().postDataJSON())
        const source = toRecord(body.filters).source
        await route.fulfill({
          json: searchWorkspaceKnowledgeContract.response.schema.parse({
            success: true,
            data: {
              query: body.query,
              results: samples.filter((sample) => !source || sample.connectorType === source),
              retrieval: { status: partial ? 'partial' : 'complete', timedOutLegs: [] },
              live: {
                backend: 'live',
                accounts: samples.map((sample) => ({
                  accountId: sample.documentId,
                  provider: sample.connectorType,
                  displayName: 'taylor@example.test',
                  status: partial && sample.connectorType === 'confluence' ? 'timeout' : 'ok',
                })),
                guidance: '',
              },
            },
          }),
        })
      })
      try {
        await page.goto(`${baseUrl.origin}${root}/search?q=Launch%20readiness`)
        await expect(page.getByText('Launch brief', { exact: true }).first()).toBeVisible()
        await capture('search-populated-desktop')
        await page.getByRole('button', { name: 'Filter by source: All sources' }).click()
        await capture('search-source-filter')
        await page.getByRole('menuitem', { name: 'Google Drive', exact: true }).click()
        await expect(page).toHaveURL((url) => url.searchParams.get('source') === 'google_drive')
        await expect(page.getByText('Launch readiness', { exact: true })).toHaveCount(0)
        await capture('search-filtered')
        await page.getByRole('button', { name: 'Filter by date: Any time' }).click()
        await capture('search-date-filter')
        await page.keyboard.press('Escape')
        await page.setViewportSize({ width: 390, height: 844 })
        await capture('search-populated-mobile')
        await page.setViewportSize({ width: 1440, height: 1000 })
        partial = true
        await page.goto(`${baseUrl.origin}${root}/search?q=Partial%20coverage`)
        await expect(
          page.getByText('Some apps couldn’t be searched. Showing available results.')
        ).toBeVisible()
        await capture('search-partial-coverage')
        unavailable = true
        await page.goto(`${baseUrl.origin}${root}/search?q=Provider%20outage`)
        await expect(page.getByText('Search couldn’t run.', { exact: true })).toBeVisible()
        await capture('search-error-retry')
        unavailable = false
        partial = false
        await page.getByRole('button', { name: 'Try again', exact: true }).click()
        await expect(page.getByText('Launch brief', { exact: true }).first()).toBeVisible()
        await expect(page.getByText('Search couldn’t run.', { exact: true })).toHaveCount(0)

        const citedChatId = generateId()
        const citedAnswer =
          'The checklist is complete, with final owner sign-off due Friday. <source>{"id":"document:launch-brief"}</source>\n\nThe support handoff is still in progress. <source>{"id":"document:launch-readiness"}</source>'
        await sql`insert into copilot_chats (id, user_id, organization_id, type, title, config)
        values (${citedChatId}, ${userId}, ${organizationId}, 'mothership', 'Cited launch update', ${sql.json({ conversationMode: 'assistant' })})`
        for (const [seq, role, content] of [
          [1, 'user', question],
          [2, 'assistant', citedAnswer],
        ] as const) {
          const id = generateId()
          const contentBlocks =
            role === 'assistant'
              ? [
                  {
                    type: 'tool',
                    phase: 'call',
                    toolCall: {
                      id: 'preview-retrieval',
                      name: 'search_workspace',
                      state: 'success',
                      result: {
                        success: true,
                        output: {
                          success: true,
                          data: {
                            results: samples.map((sample) => ({
                              ...sample,
                              citationId: `document:${sample.documentId}`,
                              citationUrl: sample.sourceUrl,
                            })),
                          },
                        },
                      },
                    },
                  },
                  { type: 'text', channel: 'final', content },
                ]
              : undefined
          await sql`insert into copilot_messages (id, chat_id, message_id, role, content, seq)
          values (${generateId()}, ${citedChatId}, ${id}, ${role}, ${sql.json({ id, role, content, contentBlocks, timestamp: new Date().toISOString() })}, ${seq})`
        }
        await page.goto(`${baseUrl.origin}${root}/search/chat/${citedChatId}`)
        await expect(page.getByRole('button', { name: '2 sources', exact: true })).toBeVisible()
        await capture('assistant-cited-answer')
        await page.getByRole('button', { name: '2 sources', exact: true }).click()
        await capture('assistant-sources-dropdown')
        await page.getByRole('button', { name: 'View all sources', exact: true }).click()
        const sourcesPanel = page.getByLabel('Cited sources', { exact: true })
        await expect(sourcesPanel).toBeVisible()
        await expect(sourcesPanel.getByText('Launch brief', { exact: true })).toBeVisible()
        await expect(sourcesPanel.getByText('Launch readiness', { exact: true })).toBeVisible()
        await capture('assistant-resources-panel')
        await page.setViewportSize({ width: 390, height: 844 })
        await expect(sourcesPanel).toBeVisible()
        await capture('assistant-resources-mobile')
      } finally {
        await page.unroute(searchRoute)
      }
    }
  )
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
  currentCheck = 'Teardown'
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
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        checks,
        browserErrors,
        browserErrorCount,
        browserErrorSamples,
        browserErrorEventCount,
        browserErrorEvents,
        documentResponses,
        deniedDocument,
        artifactDirectory,
      },
      null,
      2
    )
  )
}
