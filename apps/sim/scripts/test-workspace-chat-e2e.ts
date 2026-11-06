import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  type Browser,
  type BrowserContext,
  expect as browserExpect,
  chromium,
  type Locator,
  type Page,
  type Request,
} from '@playwright/test'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createLogger } from '@sim/logger'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId, generateShortId } from '@sim/utils/id'
import { toArray, toRecord } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { makeSignature } from 'better-auth/crypto'
import postgres from 'postgres'
import { MOTHERSHIP_EFFORT_OPTIONS, MOTHERSHIP_MODEL_OPTIONS } from '@/lib/mothership/model-options'

/**
 * The safety net for moving workspace chat onto one shared conversation UI: `/workspace/[id]/home`,
 * `/workspace/[id]/chat/[id]` and the workflow editor's Chat tab, against a production build, real
 * Postgres and Redis, and the scripted worker in `org-redesign-e2e/scripted-agent.ts`. Everything is
 * asserted by role, URL, network and database state, so it stays valid after the migration. One
 * failed check never stops the walk, so a run reports them all.
 *
 * Requires WORKSPACE_CHAT_E2E_BASE_URL, WORKSPACE_CHAT_E2E_DATABASE_URL,
 * WORKSPACE_CHAT_E2E_AUTH_SECRET, WORKSPACE_CHAT_E2E_AGENT_URL and WORKSPACE_CHAT_E2E_REPORT_PATH.
 * The app runs self-hosted with COPILOT_TOOL_PERMISSIONS_ENABLED, MSHIP_MODEL_SELECTOR and
 * MOTHERSHIP_BENCHMARK_ENABLED on; see the `workspace-chat` group in `.github/scripts/http-e2e.sh`.
 */
const logger = createLogger('WorkspaceChatE2E')
const expect = browserExpect.configure({ timeout: 20_000 })

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

const baseUrl = new URL(requiredEnvironment('WORKSPACE_CHAT_E2E_BASE_URL'))
assert(['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname), 'Use a local app')
const origin = baseUrl.origin
const databaseUrl = assertDisposableTestDatabaseUrl(
  requiredEnvironment('WORKSPACE_CHAT_E2E_DATABASE_URL')
)
const authSecret = requiredEnvironment('WORKSPACE_CHAT_E2E_AUTH_SECRET')
const agentUrl = new URL(requiredEnvironment('WORKSPACE_CHAT_E2E_AGENT_URL')).origin
const reportPath = resolve(requiredEnvironment('WORKSPACE_CHAT_E2E_REPORT_PATH'))
const artifactDirectory = `${reportPath}.artifacts`
const sql = postgres(databaseUrl.toString(), { max: 2 })

const CHECK_TIMEOUT_MS = 180_000
const CHAT_URL = /\/chat\/[0-9a-f-]{36}/
/** Turn replies arrive through a paced reveal, on a runner the browser and server share. */
const REPLY_TIMEOUT_MS = 45_000
const DEFAULT_REPLY = 'Hello from the scripted agent.'
const LONG_CHAT_TURNS = 130
const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1440, height: 900 }

type Status = 'passed' | 'failed' | 'skipped'

interface Problem {
  check: string
  kind: 'runtime' | 'http'
  url: string
  detail: string
}

const checks: {
  name: string
  section: string
  status: Status
  durationMs: number
  error?: string
}[] = []
const unexpected: Problem[] = []
let currentCheck = 'Setup'
let currentSection = 'Setup'
let allowedFailures: RegExp[] = []
let clientAddress = 0

const userId = generateId()
const plannerId = generateId()
const workspaceId = generateId()
const workflowId = generateId()
const copilotWorkflowId = generateId()
const tableId = generateId()
const fileId = generateId()
const knowledgeId = generateId()
const skillId = generateId()
const folderId = generateId()
const pastChatId = generateId()
const sessionToken = generateShortId()
const plannerSessionToken = generateShortId()
const MENTION_NAMES = {
  workflow: 'e2eworkflow',
  table: 'e2etable',
  file: 'e2efile.md',
  knowledge: 'e2eknowledge',
  chat: 'e2epastchat',
  folder: 'e2efolder',
  skill: 'e2e-skill',
}

const home = () => `${origin}/workspace/${workspaceId}/home`
const chatUrl = (chatId: string) => `${origin}/workspace/${workspaceId}/chat/${chatId}`

function reportCounts() {
  const counts = { passed: 0, failed: 0, skipped: 0 }
  for (const entry of checks) counts[entry.status] += 1
  return counts
}

/** Written as the run goes, so a job that runs out of time still leaves what it found. */
function writeReport() {
  mkdirSync(dirname(reportPath), { recursive: true })
  const counts = reportCounts()
  writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        status: counts.failed > 0 || unexpected.length > 0 ? 'failed' : 'passed',
        counts,
        checks,
        unexpected,
        artifactDirectory,
      },
      null,
      2
    )}\n`
  )
}

function recordProblem(kind: Problem['kind'], address: string, detail: string) {
  const signature = `${kind} ${address} ${detail}`
  if (allowedFailures.some((pattern) => pattern.test(signature))) return
  if (unexpected.some((entry) => entry.check === currentCheck && entry.detail === detail)) return
  unexpected.push({ check: currentCheck, kind, url: address, detail: truncate(detail, 500) })
}

function isSameOrigin(address: string) {
  try {
    return new URL(address).origin === origin
  } catch {
    return false
  }
}

function section(name: string) {
  currentSection = name
  writeReport()
}

interface CheckOptions {
  /** Failures this check provokes on purpose. */
  allow?: RegExp[]
}

async function check(name: string, run: () => Promise<void>, options: CheckOptions = {}) {
  currentCheck = `${currentSection}: ${name}`
  allowedFailures = options.allow ?? []
  const started = performance.now()
  const timeout = createDeferred<never>()
  const timer = setTimeout(
    () => timeout.reject(new Error(`Timed out after ${CHECK_TIMEOUT_MS}ms`)),
    CHECK_TIMEOUT_MS
  )
  let error: string | undefined
  try {
    await Promise.race([run(), timeout.promise])
  } catch (caught) {
    error = truncate(getErrorMessage(caught), 2000)
  } finally {
    clearTimeout(timer)
    allowedFailures = []
  }
  checks.push({
    name,
    section: currentSection,
    status: error ? 'failed' : 'passed',
    durationMs: Math.round(performance.now() - started),
    ...(error ? { error } : {}),
  })
  if (error) logger.error(`FAIL ${currentSection}: ${name}`, { error })
  else logger.info(`PASS ${currentSection}: ${name}`)
  writeReport()
}

/** A behavior this environment cannot exercise, kept in the report with its reason. */
function notProvable(name: string, reason: string) {
  checks.push({ name, section: currentSection, status: 'skipped', durationMs: 0, error: reason })
  writeReport()
}

const browser: Browser = await chromium.launch()

interface Session {
  context: BrowserContext
  page: Page
  chatPosts: Record<string, unknown>[]
}

interface OpenOptions {
  phone?: boolean
  token?: string
}

async function open(options: OpenOptions = {}): Promise<Session> {
  clientAddress += 1
  const context = await browser.newContext({
    // Better Auth limits by address, and hundreds of loads from one would be nobody's real traffic.
    extraHTTPHeaders: {
      'x-forwarded-for': `10.1.${Math.floor(clientAddress / 250)}.${clientAddress % 250}`,
    },
    viewport: options.phone ? PHONE : DESKTOP,
    hasTouch: options.phone === true,
    isMobile: options.phone === true,
  })
  const token = options.token ?? sessionToken
  await context.addCookies([
    {
      name: 'better-auth.session_token',
      value: encodeURIComponent(`${token}.${await makeSignature(token, authSecret)}`),
      url: origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
  // Records what the app copies: a headless browser's clipboard needs a permission the page never asks for.
  await context.addInitScript(() => {
    const recorder = window as typeof window & { __copied?: string[] }
    recorder.__copied = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          recorder.__copied?.push(text)
        },
        write: async (items: ClipboardItem[]) => {
          for (const item of items) {
            const blob = await item.getType('text/plain')
            recorder.__copied?.push(await blob.text())
          }
        },
        readText: async () => recorder.__copied?.at(-1) ?? '',
      },
    })
  })
  const page = await context.newPage()
  const chatPosts: Record<string, unknown>[] = []
  page.on('pageerror', (error) => {
    if (!/NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK/.test(error.message))
      recordProblem('runtime', page.url(), error.message)
  })
  page.on('request', (request) => {
    if (request.method() !== 'POST' || !isChatPost(request)) return
    chatPosts.push(toRecord(request.postDataJSON()))
  })
  page.on('response', (response) => {
    if (response.status() < 500 || !isSameOrigin(response.url())) return
    recordProblem(
      'http',
      response.url(),
      `${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`
    )
  })
  return { context, page, chatPosts }
}

function isChatPost(request: Request) {
  return new URL(request.url()).pathname === '/api/mothership/chat'
}

async function withSession(run: (session: Session) => Promise<void>, options: OpenOptions = {}) {
  const session = await open(options)
  try {
    await run(session)
  } catch (error) {
    mkdirSync(artifactDirectory, { recursive: true })
    await session.page
      .screenshot({
        path: resolve(artifactDirectory, `failure-${checks.length + 1}.png`),
        timeout: 5_000,
      })
      .catch(() => {})
    throw error
  } finally {
    await session.context.close().catch(() => {})
  }
}

/** A short alphanumeric token: markdown reads `_` and `-` as syntax, and a suite's lines add `-`. */
function newToken() {
  return `t${generateShortId(10)
    .replace(/[^a-zA-Z0-9]/g, 'x')
    .toLowerCase()}`
}

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message' })
const sendButton = (page: Page) => page.getByRole('button', { name: 'Send message' })
const stopButton = (page: Page) => page.getByRole('button', { name: 'Stop generation' })
const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Workspace sidebar' })
const line = (token: string, number: number) => `${token}-${String(number).padStart(3, '0')}`

/** The page's event handlers exist: a press before hydration would reach nothing. */
async function waitForComposer(page: Page) {
  const box = composer(page)
  await expect(box).toBeVisible({ timeout: REPLY_TIMEOUT_MS })
  await box.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        const poll = () => {
          if (Object.keys(element).some((key) => key.startsWith('__reactProps$'))) resolve()
          else setTimeout(poll, 50)
        }
        poll()
      })
  )
  return box
}

async function send(page: Page, message: string) {
  const box = await waitForComposer(page)
  await box.fill(message)
  await box.press('Enter')
}

async function openHome(page: Page) {
  await page.goto(home())
  await waitForComposer(page)
}

/** Sends the first message of a new chat and returns its id, once the URL has moved to it. */
async function startChat(page: Page, message: string) {
  await openHome(page)
  await send(page, message)
  await expect(page).toHaveURL(CHAT_URL, { timeout: REPLY_TIMEOUT_MS })
  return chatIdOf(page)
}

function chatIdOf(page: Page) {
  const match = new URL(page.url()).pathname.match(/\/chat\/([0-9a-f-]{36})/)
  assert(match, `Not on a chat: ${page.url()}`)
  return match[1]
}

async function expectIdle(page: Page) {
  await expect(stopButton(page)).toHaveCount(0, { timeout: REPLY_TIMEOUT_MS })
}

async function expectReply(page: Page, text: string | RegExp) {
  await expect(page.getByText(text).first()).toBeVisible({ timeout: REPLY_TIMEOUT_MS })
}

/** The numbered lines of a count as rendered, in order, wherever a repeat or gap would show. */
async function renderedLines(page: Page, token: string) {
  const text = await page.evaluate(() => document.body.innerText)
  return text.match(new RegExp(`${token}-\\d{3}`, 'g')) ?? []
}

function expectedLines(token: string, count: number) {
  return Array.from({ length: count }, (_, index) => line(token, index + 1))
}

async function expectEveryLineOnce(page: Page, token: string, count: number) {
  await expect
    .poll(() => renderedLines(page, token), { timeout: REPLY_TIMEOUT_MS })
    .toEqual(expectedLines(token, count))
}

async function storedAssistantText(chatId: string) {
  const rows = await sql<{ text: string | null }[]>`
    select content->>'content' as text from copilot_messages
    where chat_id = ${chatId} and role = 'assistant' and deleted_at is null order by seq`
  return rows.map((row) => row.text ?? '').join('\n')
}

async function storedUserMessages(chatId: string) {
  return sql<{ text: string | null; content: Record<string, unknown> }[]>`
    select content->>'content' as text, content from copilot_messages
    where chat_id = ${chatId} and role = 'user' and deleted_at is null order by seq`
}

async function expectStoredLinesOnce(chatId: string, token: string, count: number) {
  await expect
    .poll(
      async () => (await storedAssistantText(chatId)).match(new RegExp(`${token}-\\d{3}`, 'g')),
      {
        timeout: REPLY_TIMEOUT_MS,
      }
    )
    .toEqual(expectedLines(token, count))
}

async function agentRequests(contains: string) {
  const response = await fetch(
    `${agentUrl}/__e2e/requests?contains=${encodeURIComponent(contains)}`
  )
  const { requests } = (await response.json()) as {
    requests: { path: string; body: Record<string, unknown> }[]
  }
  return requests
}

async function agentTurns(contains: string) {
  return (await agentRequests(contains)).filter(
    (request) => request.path === '/api/mothership' || request.path === '/api/copilot'
  )
}

async function releaseGate(gate: string) {
  await fetch(`${agentUrl}/__e2e/release`, {
    method: 'POST',
    body: JSON.stringify({ gate }),
  })
}

interface SeedMessage {
  role: 'user' | 'assistant'
  content: string
  extra?: Record<string, unknown>
}

async function seedChat(title: string, messages: SeedMessage[], resources: unknown[] = []) {
  const chatId = generateId()
  await sql`insert into copilot_chats (id, user_id, workspace_id, type, title, resources)
    values (${chatId}, ${userId}, ${workspaceId}, 'mothership', ${title}, ${sql.json(resources as never)})`
  const rows = messages.map((message, index) => {
    const messageId = generateId()
    return {
      id: generateId(),
      chat_id: chatId,
      message_id: messageId,
      role: message.role,
      seq: index + 1,
      content: sql.json({
        id: messageId,
        role: message.role,
        content: message.content,
        timestamp: new Date(Date.now() - (messages.length - index) * 1000).toISOString(),
        ...message.extra,
      } as never),
    }
  })
  for (let start = 0; start < rows.length; start += 100) {
    await sql`insert into copilot_messages ${sql(rows.slice(start, start + 100))}`
  }
  return chatId
}

async function seed() {
  const email = `${userId}@workspace-chat-e2e.test`
  const plannerEmail = `${plannerId}@workspace-chat-e2e.test`
  await sql.begin(async (tx) => {
    await tx`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
      values (${userId}, 'Wren Chat', ${email}, ${email}, true, now(), now()),
             (${plannerId}, 'Pia Planner', ${plannerEmail}, ${plannerEmail}, true, now(), now())`
    await tx`update "user" set role = 'admin' where id = ${plannerId}`
    await tx`insert into settings (id, user_id, super_user_mode_enabled) values (${plannerId}, ${plannerId}, true)`
    await tx`insert into user_stats (id, user_id) values (${generateId()}, ${userId}), (${generateId()}, ${plannerId})`
    await tx`insert into project (id, name, owner_id) values (${workspaceId}, 'Workspace chat project', ${userId})`
    await tx`insert into workspace (id, project_id, name, owner_id, billed_account_user_id)
      values (${workspaceId}, ${workspaceId}, 'Workspace chat', ${userId}, ${userId})`
    await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type)
      values (${generateId()}, ${userId}, 'workspace', ${workspaceId}, 'admin'),
             (${generateId()}, ${plannerId}, 'workspace', ${workspaceId}, 'admin')`
    await tx`insert into session (id, token, user_id, expires_at, created_at, updated_at)
      values (${generateId()}, ${sessionToken}, ${userId}, now() + interval '1 day', now(), now()),
             (${generateId()}, ${plannerSessionToken}, ${plannerId}, now() + interval '1 day', now(), now())`
    await tx`insert into folder (id, resource_type, name, user_id, workspace_id)
      values (${folderId}, 'workflow', ${MENTION_NAMES.folder}, ${userId}, ${workspaceId})`
    await tx`insert into workflow (id, user_id, workspace_id, name, last_synced, created_at, updated_at)
      values (${workflowId}, ${userId}, ${workspaceId}, ${MENTION_NAMES.workflow}, now(), now(), now()),
             (${copilotWorkflowId}, ${userId}, ${workspaceId}, 'e2ecopilotworkflow', now(), now(), now())`
    await tx`insert into user_table_definitions (id, workspace_id, name, schema, created_by)
      values (${tableId}, ${workspaceId}, ${MENTION_NAMES.table},
        ${tx.json({ columns: [{ id: 'col_note', name: 'Note', type: 'string' }] })}, ${userId})`
    await tx`insert into workspace_files (id, key, user_id, workspace_id, context, original_name, content_type, size_bytes)
      values (${fileId}, ${`workspace/${fileId}.md`}, ${userId}, ${workspaceId}, 'workspace', ${MENTION_NAMES.file}, 'text/markdown', 1)`
    await tx`insert into knowledge_base (id, user_id, workspace_id, name)
      values (${knowledgeId}, ${userId}, ${workspaceId}, ${MENTION_NAMES.knowledge})`
    await tx`insert into skill (id, workspace_id, user_id, name, description, content)
      values (${skillId}, ${workspaceId}, ${userId}, ${MENTION_NAMES.skill}, 'An end-to-end skill', 'Say hello.')`
    await tx`insert into copilot_chats (id, user_id, workspace_id, type, title)
      values (${pastChatId}, ${userId}, ${workspaceId}, 'mothership', ${MENTION_NAMES.chat})`
  })
}

async function cleanup() {
  await sql.begin(async (tx) => {
    await tx`delete from permissions where entity_type = 'workspace' and entity_id = ${workspaceId}`
    await tx`delete from workspace where id = ${workspaceId}`
    await tx`delete from project where id = ${workspaceId}`
    await tx`delete from "user" where id in (${userId}, ${plannerId})`
  })
}

/** Text and markdown rendered as a person reads them, on the two routes a turn crosses. */
async function streamingChecks() {
  section('1 Streaming')
  await check('a first message on home moves to its chat and streams markdown', async () => {
    await withSession(async ({ page, chatPosts }) => {
      const token = newToken()
      await openHome(page)
      await expect(page.getByRole('heading', { name: /What should we get done/ })).toBeVisible()
      await send(page, `scripted:markdown token=${token}`)
      await expect(page).toHaveURL(CHAT_URL, { timeout: REPLY_TIMEOUT_MS })
      const chatId = chatIdOf(page)
      await expect(
        page.getByRole('heading', { name: `Release notes ${token}`, level: 2 })
      ).toBeVisible({ timeout: REPLY_TIMEOUT_MS })
      await expect(page.getByRole('listitem').filter({ hasText: 'First item' })).toBeVisible()
      await expect(page.getByRole('cell', { name: 'Ready' })).toBeVisible()
      await expect(page.locator('strong', { hasText: 'bold claim' })).toBeVisible()
      await expect(page.locator('code', { hasText: 'inline_code' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'plain link' })).toHaveAttribute(
        'href',
        'https://docs.example.com/guide'
      )
      await expectReply(page, `All done ${token}.`)
      await expectIdle(page)
      assert.equal(chatPosts.length, 1)
      assert.equal(chatPosts[0].workspaceId, workspaceId)
      assert.equal(chatPosts[0].createNewChat, true)
      await expect
        .poll(() => storedAssistantText(chatId), { timeout: REPLY_TIMEOUT_MS })
        .toContain(`All done ${token}.`)
      await expect(
        sidebar(page)
          .getByRole('link', { name: /Scripted chat/ })
          .first()
      ).toBeVisible({
        timeout: REPLY_TIMEOUT_MS,
      })
      const [{ title }] = await sql<{ title: string }[]>`
        select title from copilot_chats where id = ${chatId}`
      assert.equal(title, 'Scripted chat')
    })
  })
  await check(
    'a follow-up on /chat/[id] joins the same chat and survives a fresh load',
    async () => {
      await withSession(async ({ page, chatPosts }) => {
        const first = newToken()
        const second = newToken()
        const chatId = await startChat(page, `scripted:markdown token=${first}`)
        await expectReply(page, `All done ${first}.`)
        await expectIdle(page)
        await page.goto(chatUrl(chatId))
        await send(page, `scripted:markdown token=${second}`)
        await expectReply(page, `All done ${second}.`)
        await expectIdle(page)
        assert.equal(chatPosts.at(-1)?.chatId, chatId)
        assert.equal(chatPosts.at(-1)?.createNewChat, false)
        await page.reload()
        await expect(
          page.getByRole('heading', { name: `Release notes ${first}`, level: 2 })
        ).toBeVisible({ timeout: REPLY_TIMEOUT_MS })
        await expect(
          page.getByRole('heading', { name: `Release notes ${second}`, level: 2 })
        ).toBeVisible()
        assert.equal((await storedUserMessages(chatId)).length, 2)
      })
    }
  )
  await check('a hostile link and HTML render inert, streamed and reloaded', async () => {
    await withSession(async ({ page }) => {
      const token = newToken()
      await startChat(page, `scripted:hostile token=${token}`)
      const assertInert = async () => {
        await expectReply(page, `Hostile end ${token}.`)
        const report = await page.evaluate(() => {
          const flagged = (window as typeof window & { __chatXss?: unknown }).__chatXss
          const carriesPayload = Array.from(document.querySelectorAll('body *')).filter((element) =>
            Array.from(element.attributes).some((attribute) =>
              attribute.value.includes('__chatXss')
            )
          )
          return {
            flagged: flagged ?? null,
            carriesPayload: carriesPayload.map((element) => element.tagName),
            // The page's own data scripts may quote the transcript; a rendered one starts with it.
            hostileScripts: Array.from(document.scripts).filter((script) =>
              script.textContent?.trim().startsWith('window.__chatXss')
            ).length,
          }
        })
        assert.deepEqual(report, { flagged: null, carriesPayload: [], hostileScripts: 0 })
      }
      await assertInert()
      await expectIdle(page)
      await page.reload()
      await assertInert()
      assert.equal(new URL(page.url()).origin, origin)
    })
  })
  await check('code is highlighted and offers its own copy', async () => {
    await withSession(async ({ page }) => {
      const token = newToken()
      await startChat(page, `scripted:markdown token=${token}`)
      await expectReply(page, `All done ${token}.`)
      const code = page.locator('pre', { hasText: 'const answer' }).first()
      await expect(code).toContainText('return value * 2')
      const colors = await code.evaluate((element) => {
        const distinct = new Set<string>()
        for (const span of element.querySelectorAll('span')) {
          distinct.add(getComputedStyle(span).color)
        }
        return distinct.size
      })
      assert(colors >= 2, `Expected highlighted tokens in more than one color, got ${colors}`)
    })
  })
  await check('Stop ends the turn, keeps what arrived and records it stopped', async () => {
    await withSession(async ({ page }) => {
      const token = newToken()
      await startChat(page, `scripted:count token=${token} n=200 ms=150`)
      await expectReply(page, line(token, 3))
      const stopRequest = page.waitForRequest(
        (request) =>
          request.method() === 'POST' && /\/api\/mothership\/chat\/stop$/.test(request.url())
      )
      await stopButton(page).click()
      await stopRequest
      await expect(page.getByText('Stopped by user')).toBeVisible({ timeout: REPLY_TIMEOUT_MS })
      await expectIdle(page)
      await expect(sendButton(page)).toBeVisible()
      const chatId = chatIdOf(page)
      await expect
        .poll(
          async () => {
            const [run] = await sql<{ status: string }[]>`
              select status from copilot_runs where chat_id = ${chatId} order by started_at desc limit 1`
            return run?.status
          },
          { timeout: REPLY_TIMEOUT_MS }
        )
        .toBe('cancelled')
      const settled = (await renderedLines(page, token)).length
      await sleep(1_500)
      assert.equal((await renderedLines(page, token)).length, settled)
      assert(settled < 200, `Stop kept streaming to ${settled} lines`)
      await expect
        .poll(() => storedAssistantText(chatId), { timeout: REPLY_TIMEOUT_MS })
        .toContain(line(token, 1))
    })
  })
  await check('a turn that fails shows its error, and the same message goes again', async () => {
    await withSession(async ({ page, chatPosts }) => {
      const token = newToken()
      await startChat(page, `scripted:fail-once token=${token}`)
      await expectReply(page, `Scripted failure ${token}`)
      await expectIdle(page)
      const box = composer(page)
      await box.press('ArrowUp')
      await expect(box).toHaveValue(`scripted:fail-once token=${token}`)
      await box.press('Enter')
      await expectReply(page, `Recovered answer ${token}.`)
      await expectIdle(page)
      assert.equal(chatPosts.length, 2)
      assert.equal((await agentTurns(`token=${token}`)).length, 2)
    })
  })
  await check(
    'a send that cannot reach the app retries itself under one id and runs once',
    async () => {
      await withSession(async ({ page, chatPosts }) => {
        const token = newToken()
        let aborted = false
        await page.route('**/api/mothership/chat', async (route) => {
          if (!aborted && route.request().method() === 'POST') {
            aborted = true
            await route.abort('failed')
            return
          }
          await route.fallback()
        })
        await openHome(page)
        await send(page, `scripted:markdown token=${token}`)
        await expectReply(page, `All done ${token}.`)
        await expectIdle(page)
        assert.equal((await agentTurns(`token=${token}`)).length, 1)
        const ids = new Set(chatPosts.map((post) => post.userMessageId))
        assert.equal(ids.size, 1, 'The retry must reuse the first attempt id')
      })
    }
  )
  await check('a worker refusal for spend ends the turn with the upgrade card', async () => {
    await withSession(async ({ page }) => {
      await startChat(page, `scripted:http-402 token=${newToken()}`)
      await expect(page.getByText('Usage Limit Reached')).toBeVisible({
        timeout: REPLY_TIMEOUT_MS,
      })
      await expectIdle(page)
    })
  })
}

/**
 * Severs the live chat stream at the browser, with the reader seeing the same rejection a dropped
 * connection gives it. Offline emulation leaves an open fetch stream flowing, so it proves nothing
 * here; this aborts the real request, so the socket really closes.
 */
async function installStreamSeverance(context: BrowserContext) {
  await context.addInitScript(() => {
    const open = new Set<AbortController>()
    const original = window.fetch.bind(window)
    const faults = window as typeof window & { __severChatStreams?: () => number }
    faults.__severChatStreams = () => {
      const count = open.size
      for (const controller of open) controller.abort(new TypeError('network error'))
      open.clear()
      return count
    }
    window.fetch = async (input, init) => {
      const address =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const pathname = new URL(address, location.href).pathname
      const isStream =
        (pathname === '/api/mothership/chat' && init?.method === 'POST') ||
        (pathname === '/api/mothership/chat/stream' && !address.includes('batch=true'))
      if (!isStream) return original(input, init)
      const controller = new AbortController()
      const signal = init?.signal
        ? AbortSignal.any([init.signal, controller.signal])
        : controller.signal
      const response = await original(input, { ...init, signal })
      open.add(controller)
      return response
    }
  })
}

async function reconnectChecks() {
  section('2 Reload and reconnect')
  await check(
    'a reload mid-stream continues the transcript with nothing lost or repeated',
    async () => {
      await withSession(async ({ page }) => {
        const token = newToken()
        const count = 24
        const gate = `${token}-go`
        const chatId = await startChat(
          page,
          `scripted:count token=${token} n=${count} ms=60 gate=${gate} gateAt=10`
        )
        await expectReply(page, line(token, 9))
        const replay = page.waitForRequest((request) =>
          request.url().includes('/api/mothership/chat/stream?')
        )
        await page.reload()
        await replay
        await expect(stopButton(page)).toBeVisible({ timeout: REPLY_TIMEOUT_MS })
        await expectEveryLineOnce(page, token, 9)
        await releaseGate(gate)
        await expectEveryLineOnce(page, token, count)
        await expectIdle(page)
        await expectEveryLineOnce(page, token, count)
        await expectStoredLinesOnce(chatId, token, count)
        assert.equal(
          (await agentTurns(`token=${token}`)).length,
          1,
          'A reload must not start a turn'
        )
      })
    }
  )
  await check(
    'a dropped connection reconnects from its cursor without loss or repeats',
    async () => {
      await withSession(async ({ page, context }) => {
        const token = newToken()
        const count = 24
        await installStreamSeverance(context)
        const reconnects: string[] = []
        page.on('request', (request) => {
          const address = new URL(request.url())
          if (address.pathname === '/api/mothership/chat/stream') {
            reconnects.push(address.searchParams.get('after') ?? '')
          }
        })
        const gate = `${token}-go`
        const chatId = await startChat(
          page,
          `scripted:count token=${token} n=${count} ms=60 gate=${gate} gateAt=10`
        )
        await expectReply(page, line(token, 9))
        const severed = await page.evaluate(() =>
          (window as typeof window & { __severChatStreams: () => number }).__severChatStreams()
        )
        assert.equal(severed, 1, 'The live stream should have been open')
        await expect
          .poll(() => reconnects.some((after) => Number(after) > 0), { timeout: REPLY_TIMEOUT_MS })
          .toBe(true)
        await releaseGate(gate)
        await expectEveryLineOnce(page, token, count)
        await expectIdle(page)
        await expectStoredLinesOnce(chatId, token, count)
        assert.equal(
          (await agentTurns(`token=${token}`)).length,
          1,
          'A reconnect must not start a turn'
        )
      })
    }
  )
  await check('a worker that loses its connection replays from the receipt once', async () => {
    await withSession(async ({ page }) => {
      const token = newToken()
      const count = 12
      const chatId = await startChat(
        page,
        `scripted:resumable token=${token} n=${count} severAfter=5 ms=120`
      )
      await expectEveryLineOnce(page, token, count)
      await expectIdle(page)
      await expectStoredLinesOnce(chatId, token, count)
      const legs = await agentTurns(`token=${token}`)
      assert(legs.length >= 2, 'The app should have re-attached to the worker')
      const receipt = legs.at(-1)?.body.receivedTextChars
      assert(typeof receipt === 'number' && receipt > 0, 'The re-attach should name its receipt')
      assert.equal(new Set(legs.map((leg) => leg.body.messageId)).size, 1)
    })
  })
}

async function queueChecks() {
  section('3 Queue')
  await check(
    'a message sent while busy queues, its edit replaces it, and it runs next',
    async () => {
      await withSession(async ({ page, chatPosts }) => {
        const token = newToken()
        const gate = `${token}-go`
        await startChat(page, `scripted:count token=${token} n=4 ms=50 gate=${gate} gateAt=2`)
        await expect(stopButton(page)).toBeVisible()
        const box = composer(page)
        await box.fill(`first queued ${token}`)
        await box.press('Enter')
        await expect(page.getByRole('button', { name: '1 Queued' })).toBeVisible()
        await expect(box).toHaveValue('')
        await box.fill(`second queued ${token}`)
        await box.press('Enter')
        await expect(page.getByRole('button', { name: '2 Queued' })).toBeVisible()
        await box.press('ArrowUp')
        await expect(box).toHaveValue(`second queued ${token}`)
        await expect(page.getByRole('button', { name: 'Cancel edit' })).toBeVisible()
        await box.fill(`edited queued ${token}`)
        await box.press('Enter')
        await expect(page.getByRole('button', { name: 'Cancel edit' })).toHaveCount(0)
        await expect(page.getByText(`edited queued ${token}`).first()).toBeVisible()
        await expect(page.getByText(`second queued ${token}`)).toHaveCount(0)
        await expect(page.getByRole('button', { name: '2 Queued' })).toBeVisible()
        assert.equal(chatPosts.length, 1, 'Queued messages wait for the running turn')
        await releaseGate(gate)
        await expect
          .poll(() => chatPosts.map((post) => post.message), { timeout: REPLY_TIMEOUT_MS })
          .toEqual(expect.arrayContaining([`first queued ${token}`, `edited queued ${token}`]))
        await expectIdle(page)
        await expect(page.getByRole('button', { name: /\d+ Queued/ })).toHaveCount(0)
        const messages = chatPosts.map((post) => post.message)
        assert(
          messages.indexOf(`first queued ${token}`) < messages.indexOf(`edited queued ${token}`),
          'The queue drains in order'
        )
      })
    }
  )
  await check(
    'Enter on an empty composer sends the queue head now, ending the running turn',
    async () => {
      await withSession(async ({ page, chatPosts }) => {
        const token = newToken()
        await startChat(page, `scripted:count token=${token} n=200 ms=150`)
        await expectReply(page, line(token, 2))
        const box = composer(page)
        await box.fill(`head of queue ${token}`)
        await box.press('Enter')
        await expect(page.getByRole('button', { name: '1 Queued' })).toBeVisible()
        await expect(box).toHaveValue('')
        await box.press('Enter')
        await expectReply(page, DEFAULT_REPLY)
        await expect(page.getByRole('button', { name: /\d+ Queued/ })).toHaveCount(0)
        assert.equal(chatPosts.at(-1)?.message, `head of queue ${token}`)
        const chatId = chatIdOf(page)
        await expect
          .poll(
            async () => (await storedUserMessages(chatId)).map((message) => message.text).at(-1),
            { timeout: REPLY_TIMEOUT_MS }
          )
          .toBe(`head of queue ${token}`)
      })
    }
  )
  await check('a queued row can be removed', async () => {
    await withSession(async ({ page, chatPosts }) => {
      const token = newToken()
      const gate = `${token}-go`
      await startChat(page, `scripted:count token=${token} n=3 ms=50 gate=${gate} gateAt=2`)
      await expect(stopButton(page)).toBeVisible()
      const box = composer(page)
      await box.fill(`never sent ${token}`)
      await box.press('Enter')
      await page.getByRole('button', { name: 'Remove from queue' }).click()
      await expect(page.getByRole('button', { name: /\d+ Queued/ })).toHaveCount(0)
      await releaseGate(gate)
      await expectIdle(page)
      assert(!chatPosts.some((post) => post.message === `never sent ${token}`))
    })
  })
}

async function messageActionChecks() {
  section('4 Copy, feedback, fork, rename, delete')
  await check('Copy message copies the reply as markdown', async () => {
    await withSession(async ({ page }) => {
      const token = newToken()
      await startChat(page, `scripted:markdown token=${token}`)
      await expectReply(page, `All done ${token}.`)
      await expectIdle(page)
      await page.getByRole('button', { name: 'Copy message' }).click()
      await expect
        .poll(() =>
          page.evaluate(() => (window as typeof window & { __copied: string[] }).__copied.at(-1))
        )
        .toContain(`## Release notes ${token}`)
    })
  })
  await check('feedback posts its payload, and an empty form posts nothing', async () => {
    await withSession(async ({ page }) => {
      const token = newToken()
      const message = `scripted:markdown token=${token}`
      const chatId = await startChat(page, message)
      await expectReply(page, `All done ${token}.`)
      await expectIdle(page)
      const posts: Record<string, unknown>[] = []
      page.on('request', (request) => {
        if (request.url().endsWith('/api/copilot/feedback'))
          posts.push(toRecord(request.postDataJSON()))
      })
      const form = page.getByRole('dialog', { name: 'Give feedback' })
      await page.getByRole('button', { name: 'Like', exact: true }).click()
      await form.getByRole('button', { name: 'Submit' }).click()
      await expect(form).toHaveCount(0)
      assert.equal(posts.length, 0)
      await page.getByRole('button', { name: 'Dislike', exact: true }).click()
      await form.getByRole('textbox', { name: 'Feedback' }).fill(`Too terse ${token}`)
      const posted = page.waitForResponse((response) =>
        response.url().endsWith('/api/copilot/feedback')
      )
      await form.getByRole('button', { name: 'Submit' }).click()
      assert((await posted).ok())
      assert.equal(posts.length, 1)
      assert.equal(posts[0].chatId, chatId)
      assert.equal(posts[0].userQuery, message)
      assert.equal(posts[0].isPositiveFeedback, false)
      assert.equal(posts[0].feedback, `Too terse ${token}`)
      assert(String(posts[0].agentResponse).includes(`All done ${token}.`))
      const rows = await sql<{ feedback: string; is_positive: boolean; user_query: string }[]>`
        select feedback, is_positive, user_query from copilot_feedback where chat_id = ${chatId}`
      assert.deepEqual(
        [...rows],
        [{ feedback: `Too terse ${token}`, is_positive: false, user_query: message }]
      )
    })
  })
  await check('Fork opens a new chat holding the transcript up to that reply', async () => {
    await withSession(async ({ page }) => {
      const token = newToken()
      const chatId = await startChat(page, `scripted:markdown token=${token}`)
      await expectReply(page, `All done ${token}.`)
      await expectIdle(page)
      await page
        .getByRole('button', { name: 'Fork in new chat' })
        .click({ timeout: REPLY_TIMEOUT_MS })
      await expect(page).not.toHaveURL(chatUrl(chatId), { timeout: REPLY_TIMEOUT_MS })
      const forkId = chatIdOf(page)
      await expect(
        page.getByRole('heading', { name: `Release notes ${token}`, level: 2 })
      ).toBeVisible({ timeout: REPLY_TIMEOUT_MS })
      assert((await storedAssistantText(forkId)).includes(`All done ${token}.`))
      assert.equal((await storedUserMessages(forkId)).length, 1)
      const [source] = await sql<{ deleted_at: Date | null }[]>`
        select deleted_at from copilot_chats where id = ${chatId}`
      assert.equal(source.deleted_at, null)
    })
  })
  const openChatMenu = async (page: Page, title: string) => {
    const row = sidebar(page).getByRole('link', { name: new RegExp(title) })
    await expect(row).toBeVisible({ timeout: REPLY_TIMEOUT_MS })
    await row.hover()
    await row.getByRole('button', { name: 'Chat options' }).click()
  }
  await check('rename from the sidebar saves the title', async () => {
    const title = `Rename target ${newToken()}`
    const renamed = `Renamed ${newToken()}`
    const chatId = await seedChat(title, [
      { role: 'user', content: 'Rename this.' },
      { role: 'assistant', content: 'Sure.' },
    ])
    await withSession(async ({ page }) => {
      await page.goto(chatUrl(chatId))
      await openChatMenu(page, title)
      await page.getByRole('menuitem', { name: 'Rename' }).click()
      const input = sidebar(page).locator('input:focus')
      await expect(input).toHaveValue(title)
      await input.fill(renamed)
      await input.press('Enter')
      await expect(sidebar(page).getByRole('link', { name: new RegExp(renamed) })).toBeVisible()
      await expect
        .poll(async () => {
          const [row] = await sql<{ title: string }[]>`
            select title from copilot_chats where id = ${chatId}`
          return row.title
        })
        .toBe(renamed)
      await page.reload()
      await expect(sidebar(page).getByRole('link', { name: new RegExp(renamed) })).toBeVisible({
        timeout: REPLY_TIMEOUT_MS,
      })
    })
  })
  await check('delete from the sidebar soft-deletes the chat and leaves its route', async () => {
    const title = `Delete target ${newToken()}`
    const chatId = await seedChat(title, [
      { role: 'user', content: 'Delete this.' },
      { role: 'assistant', content: 'Sure.' },
    ])
    await withSession(async ({ page }) => {
      await page.goto(chatUrl(chatId))
      await openChatMenu(page, title)
      await page.getByRole('menuitem', { name: 'Delete' }).click()
      await expect(page.getByText('Delete chat').first()).toBeVisible()
      await page.getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(page).toHaveURL(home(), { timeout: REPLY_TIMEOUT_MS })
      await expect(sidebar(page).getByRole('link', { name: new RegExp(title) })).toHaveCount(0)
      await expect
        .poll(async () => {
          const [row] = await sql<{ deleted_at: Date | null }[]>`
            select deleted_at from copilot_chats where id = ${chatId}`
          return row.deleted_at !== null
        })
        .toBe(true)
    })
  })
}

async function toolCheck() {
  section('5 Tool cards and interactions')
  await check(
    'tool calls show running, completed and failed, and disclose their steps',
    async () => {
      await withSession(async ({ page }) => {
        const token = newToken()
        const chatId = await startChat(page, `scripted:tools token=${token}`)
        const running = page
          .getByRole('status')
          .filter({ hasText: `handbook ${token}` })
          .first()
        await expect(running).toBeVisible({ timeout: REPLY_TIMEOUT_MS })
        await expect(stopButton(page)).toBeVisible()
        await releaseGate(`${token}-first`)
        await expectReply(page, `Tools finished ${token}.`)
        await expectIdle(page)
        const disclosure = page.getByRole('button', { expanded: false }).filter({
          has: page.getByRole('status'),
        })
        await expect(disclosure.first()).toBeVisible()
        await disclosure.first().click()
        await expect(page.getByRole('button', { expanded: true }).first()).toBeVisible()
        await expect(
          page
            .getByRole('status')
            .filter({ hasText: `archive ${token}` })
            .first()
        ).toBeVisible()
        await expect(
          page
            .getByRole('status')
            .filter({ hasText: `wiki ${token}` })
            .first()
        ).toBeVisible()
        await expect
          .poll(
            async () => {
              const [row] = await sql<{ statuses: string[] | null }[]>`
              select array_agg(coalesce(block->'toolCall'->>'state', block->'toolCall'->>'status')) as statuses
              from copilot_messages, jsonb_array_elements(content->'contentBlocks') as block
              where chat_id = ${chatId} and role = 'assistant' and block ? 'toolCall'`
              return [...(row?.statuses ?? [])].sort()
            },
            { timeout: REPLY_TIMEOUT_MS }
          )
          .toEqual(['error', 'success', 'success'])
      })
    }
  )
  const decision = async (chatId: string) => {
    const rows = await sql<{ permission_decision: string | null }[]>`
      select calls.permission_decision from copilot_async_tool_calls calls
      join copilot_runs runs on runs.id = calls.run_id
      where runs.chat_id = ${chatId}`
    return rows.map((row) => row.permission_decision)
  }
  const resumeResults = async (token: string) => {
    const legs = await agentRequests(`${token}-call-1`)
    const resume = legs.find((leg) => leg.path === '/api/tools/resume')
    return toArray(resume?.body.results)
  }
  await check('Allow on the inline permission card lets the turn go on', async () => {
    await withSession(async ({ page }) => {
      const token = newToken()
      const chatId = await startChat(page, `scripted:approval token=${token}`)
      const allow = page.getByRole('button', { name: 'Allow', exact: true })
      await expect(allow).toBeVisible({ timeout: REPLY_TIMEOUT_MS })
      await expect(page.getByText(new RegExp(`Cancelling run ${token} 1`)).first()).toBeVisible()
      await expect(page.getByRole('button', { name: 'Skip', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: "Don't ask again" })).toBeVisible()
      const answered = page.waitForResponse((response) =>
        response.url().endsWith('/api/copilot/tool-permission')
      )
      await allow.click()
      assert((await answered).ok())
      await expectReply(page, `Resumed ${token} declined 0 of 1.`)
      await expectIdle(page)
      await expect(allow).toHaveCount(0)
      assert.deepEqual(await decision(chatId), ['allow'])
      assert.equal((await resumeResults(token)).length, 1)
    })
  })
  await check('Skip on the permission card runs nothing and tells the model so', async () => {
    await withSession(async ({ page }) => {
      const token = newToken()
      const chatId = await startChat(page, `scripted:approval token=${token}`)
      await page
        .getByRole('button', { name: 'Skip', exact: true })
        .click({ timeout: REPLY_TIMEOUT_MS })
      await expectReply(page, `Resumed ${token} declined 1 of 1.`)
      await expectIdle(page)
      assert.deepEqual(await decision(chatId), ['skip'])
      await expect(page.getByRole('button', { name: 'Allow', exact: true })).toHaveCount(0)
      await page.reload()
      await expectReply(page, `Resumed ${token} declined 1 of 1.`)
      await expect(page.getByRole('button', { name: 'Allow', exact: true })).toHaveCount(0)
    })
  })
  await check('a permission prompt survives a reload and still answers', async () => {
    await withSession(async ({ page }) => {
      const token = newToken()
      await startChat(page, `scripted:approval token=${token}`)
      const allow = page.getByRole('button', { name: 'Allow', exact: true })
      await expect(allow).toBeVisible({ timeout: REPLY_TIMEOUT_MS })
      await page.reload()
      await expect(allow).toBeVisible({ timeout: REPLY_TIMEOUT_MS })
      await allow.click()
      await expectReply(page, `Resumed ${token} declined 0 of 1.`)
      await expectIdle(page)
    })
  })
  await check(
    'several prompts answer together, and allowing for the chat stops asking',
    async () => {
      await withSession(async ({ page }) => {
        const token = newToken()
        const chatId = await startChat(page, `scripted:approval token=${token} n=2`)
        await expect(page.getByText('2 tools need permission')).toBeVisible({
          timeout: REPLY_TIMEOUT_MS,
        })
        await page.getByRole('button', { name: 'Allow all' }).click()
        await expectReply(page, `Resumed ${token} declined 0 of 2.`)
        await expectIdle(page)
        const second = newToken()
        await send(page, `scripted:approval token=${second}`)
        await page
          .getByRole('button', { name: "Don't ask again" })
          .click({ timeout: REPLY_TIMEOUT_MS })
        await page.getByRole('menuitem', { name: 'For this chat' }).click()
        await expectReply(page, `Resumed ${second} declined 0 of 1.`)
        await expectIdle(page)
        await expect
          .poll(async () => {
            const [row] = await sql<{ allowed: unknown }[]>`
            select auto_allowed_tools as allowed from copilot_chats where id = ${chatId}`
            return toArray(row.allowed).length
          })
          .toBeGreaterThan(0)
        const third = newToken()
        await send(page, `scripted:approval token=${third}`)
        await expectReply(page, `Resumed ${third} declined 0 of 1.`)
        await expectIdle(page)
      })
    }
  )
  await check('a question card answers once, as the turn the model reads', async () => {
    await withSession(async ({ page, chatPosts }) => {
      const token = newToken()
      const prompt = `Which region ${token}?`
      const chatId = await startChat(page, `scripted:question token=${token}`)
      await expect(page.getByText(prompt)).toBeVisible({ timeout: REPLY_TIMEOUT_MS })
      await expect(page.getByRole('textbox', { name: prompt })).toBeVisible()
      await page.getByRole('button', { name: 'South', exact: true }).click()
      await expectReply(page, DEFAULT_REPLY)
      await expectIdle(page)
      assert.equal(chatPosts.at(-1)?.message, `${prompt} — South`)
      await expect(page.getByText('South', { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'South', exact: true })).toHaveCount(0)
      await page.reload()
      await expect(page.getByText('South', { exact: true })).toBeVisible({
        timeout: REPLY_TIMEOUT_MS,
      })
      await expect(page.getByRole('button', { name: 'South', exact: true })).toHaveCount(0)
      const stored = await storedUserMessages(chatId)
      assert.equal(stored.at(-1)?.text, `${prompt} — South`)
    })
  })
  await check(
    'a question card takes typed text, and dismissing it brings the actions back',
    async () => {
      await withSession(async ({ page, chatPosts }) => {
        const typed = newToken()
        const prompt = `Which region ${typed}?`
        await startChat(page, `scripted:question token=${typed}`)
        await page
          .getByRole('textbox', { name: prompt })
          .fill('Somewhere else', { timeout: REPLY_TIMEOUT_MS })
        await page.getByRole('button', { name: 'Submit answer' }).click()
        await expectReply(page, DEFAULT_REPLY)
        await expectIdle(page)
        assert.equal(chatPosts.at(-1)?.message, `${prompt} — Somewhere else`)
        const dismissed = newToken()
        await send(page, `scripted:question token=${dismissed}`)
        await expect(page.getByText(`Which region ${dismissed}?`)).toBeVisible({
          timeout: REPLY_TIMEOUT_MS,
        })
        await expectIdle(page)
        const copyActions = page.getByRole('button', { name: 'Copy message' })
        const before = await copyActions.count()
        await page.getByRole('button', { name: 'Dismiss' }).click()
        await expect(page.getByText(`Which region ${dismissed}?`)).toHaveCount(0)
        await expect(copyActions).toHaveCount(before + 1)
      })
    }
  )
  await check(
    'a connect card links to its target and keeps the secret out of the transcript',
    async () => {
      await withSession(async ({ page, chatPosts }) => {
        const token = newToken()
        const secret = `secret${newToken()}`
        const chatId = await startChat(page, `scripted:credential token=${token}`)
        const link = page.getByRole('link', { name: /gmail/i })
        await expect(link).toHaveAttribute('href', `https://connect.example.com/${token}`, {
          timeout: REPLY_TIMEOUT_MS,
        })
        await expect(link).toHaveAttribute('target', '_blank')
        await expect(link).toHaveAttribute('rel', /noopener/)
        const field = page.getByRole('textbox', { name: 'WORKSPACE_CHAT_E2E_KEY' })
        await field.fill(secret)
        await page.getByRole('button', { name: 'Submit', exact: true }).click()
        await expect.poll(() => chatPosts.length, { timeout: REPLY_TIMEOUT_MS }).toBeGreaterThan(1)
        await expectIdle(page)
        assert(!JSON.stringify(chatPosts).includes(secret), 'The secret must not reach the turn')
        assert(!(await page.evaluate(() => document.body.innerText)).includes(secret))
        assert(!(await storedAssistantText(chatId)).includes(secret))
        const stored = await storedUserMessages(chatId)
        assert(!JSON.stringify(stored).includes(secret))
        const [saved] = await sql<{ variables: Record<string, unknown> }[]>`
        select variables from workspace_environment where workspace_id = ${workspaceId}`
        assert(
          saved?.variables.WORKSPACE_CHAT_E2E_KEY,
          'The secret should be saved to the workspace'
        )
        assert(!JSON.stringify(saved.variables).includes(secret), 'A saved secret is encrypted')
      })
    }
  )
  await check('the usage upgrade card names the limit and links to the plan', async () => {
    await withSession(async ({ page }) => {
      const token = newToken()
      await startChat(page, `scripted:usage-upgrade token=${token}`)
      await expect(page.getByText('Usage Limit Reached')).toBeVisible({
        timeout: REPLY_TIMEOUT_MS,
      })
      await expect(page.getByText(`You are out of credits ${token}.`)).toBeVisible()
      await expect(page.getByRole('link', { name: /Upgrade Plan/ })).toHaveAttribute(
        'href',
        /^https?:\/\//
      )
    })
  })
  await check(
    'suggested follow-ups send their title and only while they are the tail',
    async () => {
      await withSession(async ({ page, chatPosts }) => {
        const token = newToken()
        await startChat(page, `scripted:options token=${token}`)
        await expect(page.getByText('Suggested follow-ups')).toBeVisible({
          timeout: REPLY_TIMEOUT_MS,
        })
        const pick = page.getByRole('button', { name: new RegExp(`Draft a summary ${token}`) })
        await pick.click()
        await expectReply(page, DEFAULT_REPLY)
        await expectIdle(page)
        assert.equal(chatPosts.at(-1)?.message, `Draft a summary ${token}`)
        await expect(
          page.getByRole('button', { name: new RegExp(`List the risks ${token}`) })
        ).toBeDisabled()
      })
    }
  )
  await check('Plan mode reaches the worker, and stays off for an ordinary member', async () => {
    await withSession(async ({ page }) => {
      await openHome(page)
      await expect(page.getByRole('button', { name: 'Plan', exact: true })).toHaveCount(0)
    })
    await withSession(
      async ({ page, chatPosts }) => {
        const token = newToken()
        await openHome(page)
        const plan = page.getByRole('button', { name: 'Plan', exact: true })
        await plan.click()
        await expect(plan).toHaveAttribute('aria-pressed', 'true')
        await send(page, `scripted:plan token=${token}`)
        await expectReply(page, `Plan turn ${token} mode plan.`)
        await expect(page.getByText(`Updating plan ${token}`)).toHaveCount(0)
        assert.equal(chatPosts[0].mode, 'plan')
        const [turn] = await agentTurns(`token=${token}`)
        assert.equal(turn.body.mode, 'plan')
      },
      { token: plannerSessionToken }
    )
  })
}

async function citationChecks() {
  section('6 Citations and sources')
  await check(
    'citations render inline and the sources popover opens the sources view',
    async () => {
      await withSession(async ({ page }) => {
        const token = newToken()
        await startChat(page, `scripted:citations token=${token}`)
        const inline = page.getByRole('link', { name: `Service bulletin ${token}` }).first()
        await expect(inline).toHaveAttribute('href', `https://docs.example.com/${token}/bulletin`, {
          timeout: REPLY_TIMEOUT_MS,
        })
        await expect(inline).toHaveAttribute('target', '_blank')
        await expectIdle(page)
        await page.getByRole('button', { name: '2 sources' }).click()
        const viewAll = page.getByRole('button', { name: 'View all sources' })
        await expect(viewAll).toBeVisible()
        await expect(page.getByText(`Recall playbook ${token}`).first()).toBeVisible()
        await viewAll.click()
        await expect(page).toHaveURL(/[?&]resource=/, { timeout: REPLY_TIMEOUT_MS })
        await expect(page.getByText('Sources', { exact: true }).first()).toBeVisible()
      })
    }
  )
}

/** A file in the browser, for events a real drag or paste would carry. */
function dataTransferWith(page: Page, name: string, text: string) {
  return page.evaluateHandle(
    ([fileName, content]) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([content], fileName, { type: 'text/plain' }))
      return transfer
    },
    [name, text]
  )
}

const attachment = (page: Page, name: string) =>
  page.getByRole('button', { name: `Open ${name}`, exact: true })

const uploaded = async (page: Page, name: string) => {
  await expect(page.getByRole('button', { name: `Remove ${name}` })).toBeEnabled({
    timeout: REPLY_TIMEOUT_MS,
  })
  await expect(attachment(page, name)).toBeVisible()
}

async function typeMention(page: Page, query: string, name: string) {
  const box = composer(page)
  await box.pressSequentially(`@${query}`)
  const item = page.getByRole('menuitem', { name: new RegExp(name) })
  await expect(item.first()).toBeVisible({ timeout: REPLY_TIMEOUT_MS })
  await item.first().click()
  await expect(box).toHaveValue(new RegExp(`@${name.replace('.', '\\.')}`))
}

function contextKinds(post: Record<string, unknown> | undefined) {
  return toArray<Record<string, unknown>>(post?.contexts).map((context) => context.kind)
}

async function composerChecks() {
  section('7 Composer')
  await check(
    '@ mentions attach each kind of resource to the turn and the bubble',
    async () => {
      await withSession(async ({ page, chatPosts }) => {
        await openHome(page)
        const box = composer(page)
        await box.click()
        for (const [query, name] of [
          [MENTION_NAMES.workflow, MENTION_NAMES.workflow],
          [MENTION_NAMES.table, MENTION_NAMES.table],
          ['e2efile', MENTION_NAMES.file],
          [MENTION_NAMES.knowledge, MENTION_NAMES.knowledge],
          [MENTION_NAMES.chat, MENTION_NAMES.chat],
          [MENTION_NAMES.folder, MENTION_NAMES.folder],
          ['firecrawl', 'Firecrawl'],
        ]) {
          await typeMention(page, query, name)
        }
        await box.press('Enter')
        await expect(page).toHaveURL(CHAT_URL, { timeout: REPLY_TIMEOUT_MS })
        await expectReply(page, DEFAULT_REPLY)
        const kinds = contextKinds(chatPosts[0])
        for (const kind of ['workflow', 'table', 'file', 'knowledge', 'past_chat', 'folder']) {
          assert(kinds.includes(kind), `Missing a ${kind} context in ${JSON.stringify(kinds)}`)
        }
        assert(kinds.includes('integration'), `Missing an integration in ${JSON.stringify(kinds)}`)
        const [stored] = await storedUserMessages(chatIdOf(page))
        assert(toArray(stored.content.contexts).length > 0, 'The turn keeps its contexts')
        await expect(page.getByText(MENTION_NAMES.table).first()).toBeVisible()
      })
    },
    { allow: [/\/api\/files\/serve/] }
  )
  await check('prompt history restores chips, and sends them again', async () => {
    await withSession(async ({ page, chatPosts }) => {
      const token = newToken()
      await openHome(page)
      await composer(page).click()
      await typeMention(page, MENTION_NAMES.table, MENTION_NAMES.table)
      await composer(page).pressSequentially(`look ${token}`)
      await composer(page).press('Enter')
      await expectReply(page, DEFAULT_REPLY)
      await expectIdle(page)
      await composer(page).press('ArrowUp')
      await expect(composer(page)).toHaveValue(new RegExp(`look ${token}`))
      await composer(page).press('Enter')
      await expect.poll(() => chatPosts.length, { timeout: REPLY_TIMEOUT_MS }).toBe(2)
      assert.deepEqual(contextKinds(chatPosts[1]), ['table'])
    })
  })
  await check('/ opens skills, typed or by button, and attaches the skill', async () => {
    await withSession(async ({ page, chatPosts }) => {
      await openHome(page)
      const box = composer(page)
      await box.click()
      await box.pressSequentially('/e2e')
      const skill = page.getByRole('menuitem', { name: new RegExp(MENTION_NAMES.skill) })
      await expect(skill).toBeVisible({ timeout: REPLY_TIMEOUT_MS })
      await skill.click()
      await box.press('Control+a')
      await box.press('Delete')
      await page.getByRole('button', { name: 'Skills', exact: true }).click()
      await expect(box).toHaveValue('/')
      await skill.click()
      await box.pressSequentially('now')
      await box.press('Enter')
      await expect(page).toHaveURL(CHAT_URL, { timeout: REPLY_TIMEOUT_MS })
      assert(contextKinds(chatPosts[0]).includes('skill'))
    })
  })
  await check('the + menu searches resources and inserts a chip', async () => {
    await withSession(async ({ page, chatPosts }) => {
      await openHome(page)
      await page.getByRole('button', { name: 'Add resources', exact: true }).click()
      const search = page.getByPlaceholder('Search resources')
      await expect(search).toBeVisible()
      await search.fill(MENTION_NAMES.table)
      await page
        .getByRole('menuitem', { name: new RegExp(MENTION_NAMES.table) })
        .first()
        .click({ timeout: REPLY_TIMEOUT_MS })
      const box = composer(page)
      await expect(box).toHaveValue(new RegExp(`@${MENTION_NAMES.table}`))
      await box.press('Enter')
      await expect(page).toHaveURL(CHAT_URL, { timeout: REPLY_TIMEOUT_MS })
      assert.deepEqual(contextKinds(chatPosts[0]), ['table'])
    })
  })
  await check('files attach by button, one or several, and travel with the turn', async () => {
    await withSession(async ({ page, chatPosts }) => {
      const token = newToken()
      await openHome(page)
      const chooser = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: 'Attach file', exact: true }).click()
      await (await chooser).setFiles([
        { name: `one-${token}.txt`, mimeType: 'text/plain', buffer: Buffer.from('one') },
        { name: `two-${token}.txt`, mimeType: 'text/plain', buffer: Buffer.from('two') },
      ])
      await uploaded(page, `one-${token}.txt`)
      await uploaded(page, `two-${token}.txt`)
      await page.getByRole('button', { name: `Remove two-${token}.txt` }).click()
      await expect(attachment(page, `two-${token}.txt`)).toHaveCount(0)
      const box = composer(page)
      await box.fill(`Read this ${token}`)
      await box.press('Enter')
      await expect(page).toHaveURL(CHAT_URL, { timeout: REPLY_TIMEOUT_MS })
      await expectReply(page, DEFAULT_REPLY)
      const files = toArray<Record<string, unknown>>(chatPosts[0].fileAttachments)
      assert.deepEqual(
        files.map((file) => file.filename),
        [`one-${token}.txt`]
      )
      const [stored] = await storedUserMessages(chatIdOf(page))
      assert.deepEqual(
        toArray<Record<string, unknown>>(stored.content.fileAttachments).map(
          (file) => file.filename
        ),
        [`one-${token}.txt`]
      )
      await expect(page.getByText(`one-${token}.txt`).first()).toBeVisible()
    })
  })
  await check('a dragged file and a pasted file both attach', async () => {
    await withSession(async ({ page }) => {
      const token = newToken()
      await openHome(page)
      const box = composer(page)
      const dropped = `dropped-${token}.txt`
      const droppedTransfer = await dataTransferWith(page, dropped, 'dropped')
      await box.dispatchEvent('dragenter', { dataTransfer: droppedTransfer })
      await box.dispatchEvent('dragover', { dataTransfer: droppedTransfer })
      await box.dispatchEvent('drop', { dataTransfer: droppedTransfer })
      await uploaded(page, dropped)
      const pasted = `pasted-${token}.txt`
      const pastedTransfer = await dataTransferWith(page, pasted, 'pasted')
      await box.evaluate((element, transfer) => {
        element.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
        )
      }, pastedTransfer)
      await uploaded(page, pasted)
    })
  })
  await check(
    'an upload that fails says so and leaves nothing to send',
    async () => {
      await withSession(async ({ page }) => {
        const token = newToken()
        const name = `broken-${token}.txt`
        await page.route('**/api/files/uploads', (route) =>
          route.fulfill({ status: 500, json: { error: 'Scripted upload failure' } })
        )
        await openHome(page)
        const chooser = page.waitForEvent('filechooser')
        await page.getByRole('button', { name: 'Attach file', exact: true }).click()
        await (await chooser).setFiles({
          name,
          mimeType: 'text/plain',
          buffer: Buffer.from('broken'),
        })
        await expect(page.getByText(`Couldn't upload "${name}"`)).toBeVisible({
          timeout: REPLY_TIMEOUT_MS,
        })
        await expect(attachment(page, name)).toHaveCount(0)
        await expect(sendButton(page)).toBeDisabled()
      })
    },
    { allow: [/\/api\/files\/uploads/] }
  )
  await check(
    'voice input is offered only when speech is available, and reports a blocked mic',
    async () => {
      await withSession(async ({ page }) => {
        const answered = page.waitForResponse((response) =>
          response.url().endsWith('/api/settings/voice')
        )
        await openHome(page)
        await answered
        await expect(page.getByRole('button', { name: 'Voice input' })).toHaveCount(0)
      })
      await withSession(async ({ page }) => {
        await page.route('**/api/settings/voice', (route) =>
          route.fulfill({ json: { sttAvailable: true } })
        )
        await openHome(page)
        const mic = page.getByRole('button', { name: 'Voice input' })
        await expect(mic).toBeVisible({ timeout: REPLY_TIMEOUT_MS })
        await mic.click()
        await expect(
          page
            .getByText(
              /Microphone access is blocked|No microphone found|Could not start voice input/
            )
            .first()
        ).toBeVisible()
        await expect(page.getByRole('button', { name: 'Voice input' })).toBeVisible()
      })
    }
  )
  notProvable(
    'Voice transcription into the composer',
    'Needs a microphone stream and a live speech-to-text provider, neither of which CI has'
  )
  await check('the model and reasoning level go with the turn and stay with the chat', async () => {
    await withSession(async ({ page, chatPosts }) => {
      const token = newToken()
      const effort = MOTHERSHIP_EFFORT_OPTIONS[0]
      const model = MOTHERSHIP_MODEL_OPTIONS[1]
      await openHome(page)
      await page.getByRole('button', { name: 'Model', exact: true }).click()
      await page.getByRole('menuitem', { name: model.label }).click()
      await expect(page.getByRole('button', { name: 'Model', exact: true })).toHaveAttribute(
        'aria-description',
        model.label
      )
      await page.getByRole('button', { name: 'Reasoning effort', exact: true }).click()
      await page.getByRole('menuitemradio', { name: effort.label, exact: true }).click()
      await send(page, `scripted:markdown token=${token}`)
      await expect(page).toHaveURL(CHAT_URL, { timeout: REPLY_TIMEOUT_MS })
      await expectReply(page, `All done ${token}.`)
      await expectIdle(page)
      assert.equal(chatPosts[0].effort, effort.value)
      assert.equal(toRecord(chatPosts[0].modelSelection).model, model.value)
      const [turn] = await agentTurns(`token=${token}`)
      assert.equal(turn.body.effort, effort.value)
      const chatId = chatIdOf(page)
      await page.goto(chatUrl(chatId))
      await waitForComposer(page)
      await expect(
        page.getByRole('button', { name: 'Reasoning effort', exact: true })
      ).toHaveAttribute('aria-description', effort.label, { timeout: REPLY_TIMEOUT_MS })
    })
  })
  await check('drafts belong to their chat and survive a reload, chips included', async () => {
    const first = await seedChat(`Draft one ${newToken()}`, [
      { role: 'user', content: 'First chat.' },
      { role: 'assistant', content: 'Noted.' },
    ])
    const second = await seedChat(`Draft two ${newToken()}`, [
      { role: 'user', content: 'Second chat.' },
      { role: 'assistant', content: 'Noted.' },
    ])
    await withSession(async ({ page, chatPosts }) => {
      await page.goto(chatUrl(first))
      const box = await waitForComposer(page)
      await box.click()
      await typeMention(page, MENTION_NAMES.table, MENTION_NAMES.table)
      await box.pressSequentially('draft for one')
      const firstDraft = await box.inputValue()
      await sleep(400)
      await page.goto(chatUrl(second))
      await waitForComposer(page)
      await expect(box).toHaveValue('')
      await box.fill('draft for two')
      await sleep(400)
      await page.goto(chatUrl(first))
      await waitForComposer(page)
      await expect(box).toHaveValue(firstDraft)
      await page.goto(home())
      await waitForComposer(page)
      await expect(box).toHaveValue('')
      await page.goto(chatUrl(second))
      await waitForComposer(page)
      await expect(box).toHaveValue('draft for two')
      await page.goto(chatUrl(first))
      await waitForComposer(page)
      await expect(box).toHaveValue(firstDraft)
      await box.press('Enter')
      await expect.poll(() => chatPosts.length, { timeout: REPLY_TIMEOUT_MS }).toBe(1)
      assert.deepEqual(contextKinds(chatPosts[0]), ['table'])
      await expect(box).toHaveValue('')
    })
  })
  await check('prompt history walks back and forward, and an edit ends it', async () => {
    const chatId = await seedChat(`History ${newToken()}`, [
      { role: 'user', content: 'older prompt' },
      { role: 'assistant', content: 'Older reply.' },
      { role: 'user', content: 'newer prompt' },
      { role: 'assistant', content: 'Newer reply.' },
    ])
    await withSession(async ({ page }) => {
      await page.goto(chatUrl(chatId))
      const box = await waitForComposer(page)
      await expect(page.getByText('Newer reply.')).toBeVisible({ timeout: REPLY_TIMEOUT_MS })
      await box.press('ArrowUp')
      await expect(box).toHaveValue('newer prompt')
      await box.press('ArrowUp')
      await expect(box).toHaveValue('older prompt')
      await box.press('End')
      await box.press('ArrowDown')
      await expect(box).toHaveValue('newer prompt')
      await box.press('End')
      await box.press('ArrowDown')
      await expect(box).toHaveValue('')
      await box.press('ArrowUp')
      await expect(box).toHaveValue('newer prompt')
      await box.press('End')
      await box.pressSequentially(' edited')
      await box.press('Home')
      await box.press('ArrowUp')
      await expect(box).toHaveValue('newer prompt edited')
    })
  })
  await check('on a phone Enter makes a new line and only the button sends', async () => {
    await withSession(
      async ({ page, chatPosts }) => {
        await openHome(page)
        const box = composer(page)
        await box.fill('first line')
        await box.press('End')
        await box.press('Enter')
        await box.pressSequentially('second line')
        await expect(box).toHaveValue('first line\nsecond line')
        assert.equal(chatPosts.length, 0)
        await sendButton(page).tap()
        await expect(page).toHaveURL(CHAT_URL, { timeout: REPLY_TIMEOUT_MS })
        assert.equal(chatPosts[0].message, 'first line\nsecond line')
      },
      { phone: true }
    )
  })
  await check('?resource= opens that resource and the turn says which is active', async () => {
    const chatId = await seedChat(
      `Resource ${newToken()}`,
      [
        { role: 'user', content: 'Open the file.' },
        { role: 'assistant', content: 'Here it is.' },
      ],
      [{ type: 'file', id: fileId, title: MENTION_NAMES.file, workspaceId }]
    )
    await withSession(async ({ page, chatPosts }) => {
      await page.route('**/api/files/serve/**', (route) =>
        route.fulfill({ body: '# Resource body' })
      )
      await page.goto(`${chatUrl(chatId)}?resource=${fileId}`)
      await waitForComposer(page)
      await expect(page).toHaveURL(new RegExp(`resource=${fileId}`))
      await expect(page.getByText(MENTION_NAMES.file).first()).toBeVisible({
        timeout: REPLY_TIMEOUT_MS,
      })
      await send(page, 'What does it say?')
      await expect.poll(() => chatPosts.length, { timeout: REPLY_TIMEOUT_MS }).toBe(1)
      const resources = toArray<Record<string, unknown>>(chatPosts[0].resourceAttachments)
      assert(
        resources.some((resource) => resource.id === fileId && resource.active === true),
        `Active resource missing in ${JSON.stringify(resources)}`
      )
      await expect(page).toHaveURL(new RegExp(`resource=${fileId}`))
    })
  })
}

/** Finds what actually scrolls the transcript: the nearest scrolling ancestor of a line in it. */
function transcriptScroller(page: Page, text: string): Promise<ScrollState> {
  return page.evaluate((needle) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node && !node.textContent?.includes(needle)) node = walker.nextNode()
    let element = node?.parentElement ?? null
    while (element) {
      const { overflowY } = getComputedStyle(element)
      if (/(auto|scroll)/.test(overflowY) && element.scrollHeight > element.clientHeight) {
        element.setAttribute('data-e2e-transcript', '')
        return {
          scrollTop: element.scrollTop,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        }
      }
      element = element.parentElement
    }
    throw new Error(`No scrolling ancestor for ${needle}`)
  }, text)
}

interface ScrollState {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

const transcript = (page: Page): Locator => page.locator('[data-e2e-transcript]')

const scrollState = (page: Page): Promise<ScrollState> =>
  transcript(page).evaluate((element) => ({
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }))

const scrollTranscriptTo = (page: Page, top: number) =>
  transcript(page).evaluate((element, value) => {
    element.scrollTop = value
  }, top)

const distanceFromBottom = ({ scrollTop, scrollHeight, clientHeight }: ScrollState) =>
  scrollHeight - scrollTop - clientHeight

const longUser = (index: number) => `longuser${String(index).padStart(3, '0')}`

function longTurns() {
  const messages: SeedMessage[] = []
  for (let index = 1; index <= LONG_CHAT_TURNS; index += 1) {
    const needle = index === 3 || index === 100 ? ' findneedle' : ''
    messages.push({ role: 'user', content: `${longUser(index)}${needle}` })
    messages.push({
      role: 'assistant',
      content: Array.from(
        { length: 6 },
        (_, paragraph) => `Answer ${index} paragraph ${paragraph} with enough words to take space.`
      ).join('\n\n'),
    })
  }
  return messages
}

async function transcriptChecks() {
  section('8 Find, history and long transcripts')
  const longChatId = await seedChat(`Long transcript ${newToken()}`, longTurns())
  await check(
    'older messages load behind the newest page, in order, down to the first',
    async () => {
      await withSession(async ({ page }) => {
        const older = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === `/api/mothership/chats/${longChatId}/messages` &&
            response.url().includes('before=')
        )
        await page.goto(chatUrl(longChatId))
        await expect(page.getByText(longUser(LONG_CHAT_TURNS), { exact: true })).toBeVisible({
          timeout: REPLY_TIMEOUT_MS,
        })
        assert((await older).ok())
        await transcriptScroller(page, longUser(LONG_CHAT_TURNS))
        await expect
          .poll(
            async () => {
              await scrollTranscriptTo(page, 0)
              return page.getByText(longUser(1), { exact: true }).count()
            },
            { timeout: REPLY_TIMEOUT_MS }
          )
          .toBe(1)
        await expect(page.getByText(longUser(1), { exact: true })).toBeInViewport()
      })
    }
  )
  await check('a long transcript keeps only what is near the viewport mounted', async () => {
    await withSession(async ({ page }) => {
      await page.goto(chatUrl(longChatId))
      await expect(page.getByText(longUser(LONG_CHAT_TURNS), { exact: true })).toBeVisible({
        timeout: REPLY_TIMEOUT_MS,
      })
      await expect(page.getByText(longUser(LONG_CHAT_TURNS), { exact: true })).toBeInViewport()
      const mounted = (await page.evaluate(() => document.body.innerText)).match(
        /longuser\d{3}/g
      )?.length
      assert(mounted && mounted < LONG_CHAT_TURNS / 2, `${mounted} of ${LONG_CHAT_TURNS} mounted`)
    })
  })
  await check('the find bar counts across unmounted rows, steps to them and closes', async () => {
    await withSession(async ({ page }) => {
      await page.goto(chatUrl(longChatId))
      const box = await waitForComposer(page)
      await expect(page.getByText(longUser(LONG_CHAT_TURNS), { exact: true })).toBeVisible({
        timeout: REPLY_TIMEOUT_MS,
      })
      await box.focus()
      await page.keyboard.press('Control+f')
      const find = page.getByRole('textbox', { name: 'Find in chat' })
      await expect(find).toBeVisible()
      await expect(find).toBeFocused()
      await find.fill('findneedle')
      await expect(page.getByText(/^\d+ of 2$/)).toBeVisible({ timeout: REPLY_TIMEOUT_MS })
      await page.getByRole('button', { name: 'Next match' }).click()
      await expect(
        page
          .getByText(longUser(100))
          .or(page.getByText(longUser(3)))
          .first()
      ).toBeInViewport({ timeout: REPLY_TIMEOUT_MS })
      await find.press('Enter')
      await expect(
        page
          .getByText(longUser(100))
          .or(page.getByText(longUser(3)))
          .first()
      ).toBeInViewport({ timeout: REPLY_TIMEOUT_MS })
      await find.fill('nothing matches this')
      await expect(page.getByText('No results')).toBeVisible()
      await find.press('Escape')
      await expect(find).toHaveCount(0)
    })
  })
  await check(
    'a transcript at the bottom follows the stream, and one scrolled up stays put',
    async () => {
      const chatId = await seedChat(`Scrolling ${newToken()}`, longTurns().slice(-40))
      await withSession(async ({ page }) => {
        const token = newToken()
        await page.goto(chatUrl(chatId))
        await waitForComposer(page)
        await expect(page.getByText(longUser(LONG_CHAT_TURNS), { exact: true })).toBeVisible({
          timeout: REPLY_TIMEOUT_MS,
        })
        await send(page, `scripted:count token=${token} n=60 ms=200`)
        await expectReply(page, line(token, 10))
        await transcriptScroller(page, line(token, 10))
        await expect
          .poll(async () => distanceFromBottom(await scrollState(page)), { timeout: 10_000 })
          .toBeLessThan(200)
        const box = await transcript(page).boundingBox()
        assert(box, 'The transcript has no box')
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.wheel(0, -900)
        await sleep(500)
        const parked = (await scrollState(page)).scrollTop
        await expect
          .poll(async () => (await renderedLines(page, token)).length, {
            timeout: REPLY_TIMEOUT_MS,
          })
          .toBeGreaterThan(25)
        const current = await scrollState(page)
        assert(
          Math.abs(current.scrollTop - parked) <= 8,
          `Scrolled-up view moved from ${parked} to ${current.scrollTop}`
        )
        assert(distanceFromBottom(current) > 200, 'The view should still be scrolled up')
        await stopButton(page).click()
        await expect(page.getByText('Stopped by user')).toBeAttached({ timeout: REPLY_TIMEOUT_MS })
      })
    }
  )
}

async function copilotChecks() {
  section('9 Copilot panel')
  const panel = (page: Page) => page.getByRole('complementary', { name: 'Workflow panel' })
  const openCopilot = async (page: Page) => {
    await page.goto(`${origin}/workspace/${workspaceId}/w/${copilotWorkflowId}`)
    await panel(page)
      .getByRole('button', { name: 'Chat', exact: true })
      .click({ timeout: REPLY_TIMEOUT_MS })
    await waitForComposer(page)
    return panel(page).getByRole('textbox', { name: 'Message' })
  }
  await check('the panel sends with its workflow, streams and stops', async () => {
    await withSession(async ({ page, chatPosts }) => {
      const token = newToken()
      const box = await openCopilot(page)
      await box.fill(`scripted:count token=${token} n=200 ms=150`)
      await box.press('Enter')
      await expect(panel(page).getByText(line(token, 2), { exact: true })).toBeVisible({
        timeout: REPLY_TIMEOUT_MS,
      })
      assert.equal(chatPosts[0].workflowId, copilotWorkflowId)
      await panel(page).getByRole('button', { name: 'Stop generation' }).click()
      await expect(panel(page).getByText('Stopped by user')).toBeVisible({
        timeout: REPLY_TIMEOUT_MS,
      })
    })
  })
  await check('the panel resumes a running turn after a reload', async () => {
    await withSession(async ({ page, chatPosts }) => {
      const token = newToken()
      const count = 20
      const gate = `${token}-go`
      const box = await openCopilot(page)
      await box.fill(`scripted:count token=${token} n=${count} ms=60 gate=${gate} gateAt=6`)
      await box.press('Enter')
      await expect(panel(page).getByText(line(token, 5), { exact: true })).toBeVisible({
        timeout: REPLY_TIMEOUT_MS,
      })
      const chatId = String(
        (
          await sql<{ id: string }[]>`
            select chat_id as id from copilot_messages where role = 'user' and content->>'content' like ${`%token=${token}%`}`
        )[0]?.id
      )
      await page.reload()
      await expectEveryLineOnce(page, token, 5)
      await releaseGate(gate)
      await expectEveryLineOnce(page, token, count)
      await expectIdle(page)
      await expectStoredLinesOnce(chatId, token, count)
      assert.equal(chatPosts.length, 1)
      assert.equal((await agentTurns(`token=${token}`)).length, 1)
    })
  })
  await check('the panel resizes by its handle and keeps the width', async () => {
    await withSession(async ({ page }) => {
      await openCopilot(page)
      const before = await panel(page).boundingBox()
      const handle = await page.getByRole('separator', { name: 'Resize panel' }).boundingBox()
      assert(before && handle, 'The panel has no box')
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
      await page.mouse.down()
      await page.mouse.move(handle.x - 120, handle.y + handle.height / 2, { steps: 8 })
      await page.mouse.up()
      await expect
        .poll(async () => (await panel(page).boundingBox())?.width ?? 0)
        .toBeGreaterThan(before.width + 80)
      const after = (await panel(page).boundingBox())?.width ?? 0
      await page.reload()
      await expect
        .poll(async () => Math.abs(((await panel(page).boundingBox())?.width ?? 0) - after), {
          timeout: REPLY_TIMEOUT_MS,
        })
        .toBeLessThan(4)
    })
  })
}

async function run() {
  await seed()
  await streamingChecks()
  await reconnectChecks()
  await queueChecks()
  await messageActionChecks()
  await toolCheck()
  await citationChecks()
  await composerChecks()
  await transcriptChecks()
  await copilotChecks()
}

try {
  await run()
} catch (error) {
  checks.push({
    name: 'suite setup',
    section: currentSection,
    status: 'failed',
    durationMs: 0,
    error: getErrorMessage(error),
  })
  logger.error('FAIL suite setup', { error: getErrorMessage(error) })
} finally {
  section('Teardown')
  await check('fixtures are removed', cleanup)
  await browser.close()
  await sql.end({ timeout: 5 })
  writeReport()
}

const counts = reportCounts()
logger.info('Workspace chat acceptance finished', { ...counts, unexpected: unexpected.length })
if (counts.failed > 0 || unexpected.length > 0) process.exitCode = 1
