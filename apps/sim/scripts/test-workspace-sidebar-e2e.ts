import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  type Browser,
  type BrowserContext,
  expect as browserExpect,
  chromium,
  type Locator,
  type Page,
} from '@playwright/test'
import { db } from '@sim/db'
import {
  account,
  copilotChats,
  folder,
  invitation,
  invitationWorkspaceGrant,
  knowledgeBase,
  member,
  organization,
  permissionGroup,
  permissionGroupMember,
  permissionGroupWorkspace,
  permissions,
  pinnedItem,
  project,
  session,
  subscription,
  user,
  userStats,
  userTableDefinitions,
  workflow,
  workflowBlocks,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
  workspace,
} from '@sim/db/schema'
import { assertDisposableTestDatabaseUrl } from '@sim/db/testing/test-infrastructure'
import { createLogger } from '@sim/logger'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId, generateShortId } from '@sim/utils/id'
import { escapeRegExp, normalizeEmail, truncate } from '@sim/utils/string'
import { makeSignature } from 'better-auth/crypto'
import { and, asc, eq, isNull, like } from 'drizzle-orm'

/**
 * Safety net for migrating the workspace sidebar: what a person can do with it today, asserted by
 * role, URL and database state against a hosted production build, real Postgres and Redis, the real
 * realtime server, and a scripted model. No check reads a class name, so all of them should survive
 * the migration unchanged. Each check builds its own workspace, and one failed check never stops
 * the walk, so a run reports them all.
 *
 * Requires WORKSPACE_SIDEBAR_E2E_ORIGIN, WORKSPACE_SIDEBAR_E2E_DATABASE_URL (the app's DATABASE_URL),
 * WORKSPACE_SIDEBAR_E2E_AUTH_SECRET and WORKSPACE_SIDEBAR_E2E_REPORT_PATH.
 * WORKSPACE_SIDEBAR_E2E_PHASE picks `main`, or `flags` for an app started with Chat disabled and the
 * Dashboard, Tests and Changelog flags on.
 */
const logger = createLogger('WorkspaceSidebarE2E')
const expect = browserExpect.configure({ timeout: 20_000 })

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

const origin = new URL(requiredEnvironment('WORKSPACE_SIDEBAR_E2E_ORIGIN')).origin
const databaseUrl = requiredEnvironment('WORKSPACE_SIDEBAR_E2E_DATABASE_URL')
assertDisposableTestDatabaseUrl(databaseUrl)
assert.equal(process.env.DATABASE_URL, databaseUrl, 'The suite and the app must share one database')
const authSecret = requiredEnvironment('WORKSPACE_SIDEBAR_E2E_AUTH_SECRET')
const reportPath = resolve(requiredEnvironment('WORKSPACE_SIDEBAR_E2E_REPORT_PATH'))
const phase = process.env.WORKSPACE_SIDEBAR_E2E_PHASE ?? 'main'
const artifactDirectory = `${reportPath}.artifacts`
mkdirSync(artifactDirectory, { recursive: true })

type Status = 'passed' | 'failed' | 'skipped'
const checks: {
  name: string
  section: string
  status: Status
  durationMs: number
  error?: string
}[] = []
const unexpected: { check: string; kind: string; url: string; detail: string }[] = []
const CHECK_TIMEOUT_MS = 150_000
const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }
const MOD = 'ControlOrMeta'
let currentSection = 'Setup'
let currentCheck = 'Setup'
let clientAddress = 0
/** Failures the running check provokes on purpose; anything else fails the Health check. */
let allowedUnexpected: RegExp[] = []

function recordUnexpected(kind: string, url: string, detail: string) {
  const signature = `${kind} ${url} ${detail}`
  if (allowedUnexpected.some((pattern) => pattern.test(signature))) return
  unexpected.push({ check: currentCheck, kind, url, detail: truncate(detail, 1500) })
}

const run = generateShortId(8)
  .toLowerCase()
  .replace(/[^a-z0-9]/g, 'x')
const ORGANIZATION_ID = `sidebar-org-${run}`
const unique = (label: string) => `${label}-${generateShortId(6).replace(/[^a-zA-Z0-9]/g, 'x')}`

function writeReport() {
  mkdirSync(dirname(reportPath), { recursive: true })
  const counts = { passed: 0, failed: 0, skipped: 0 }
  for (const entry of checks) counts[entry.status] += 1
  writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        status: counts.failed > 0 || checks.length === 0 ? 'failed' : 'passed',
        phase,
        counts,
        checks,
        unexpected,
        artifactDirectory,
      },
      null,
      2
    )}\n`
  )
  return counts
}

function section(name: string) {
  currentSection = name
  writeReport()
}

interface CheckOptions {
  allow?: RegExp[]
}

async function check(name: string, body: () => Promise<void>, options: CheckOptions = {}) {
  currentCheck = `${currentSection}: ${name}`
  allowedUnexpected = options.allow ?? []
  const started = performance.now()
  const deadline = createDeferred<never>()
  const timer = setTimeout(
    () => deadline.reject(new Error(`Timed out after ${CHECK_TIMEOUT_MS}ms`)),
    CHECK_TIMEOUT_MS
  )
  try {
    await Promise.race([body(), deadline.promise])
    checks.push({
      name,
      section: currentSection,
      status: 'passed',
      durationMs: Math.round(performance.now() - started),
    })
    logger.info(`PASS ${currentCheck}`)
  } catch (error) {
    const message = truncate(getErrorMessage(error), 2000)
    checks.push({
      name,
      section: currentSection,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      error: message,
    })
    logger.error(`FAIL ${currentCheck}`, { error: message })
  } finally {
    clearTimeout(timer)
    allowedUnexpected = []
    writeReport()
  }
}

/** A behavior this environment cannot exercise, kept in the report with its reason. */
function notProvable(name: string, reason: string) {
  checks.push({ name, section: currentSection, status: 'skipped', durationMs: 0, error: reason })
  writeReport()
}

const browser: Browser = await chromium.launch()

interface Persona {
  key: string
  userId: string
  email: string
  name: string
  sessionToken: string
}

function persona(key: string): Persona {
  return {
    key,
    userId: `sidebar-user-${key}-${run}`,
    email: `${key}-${run}@workspace-sidebar.test`,
    name: `Sidebar ${key} ${run}`,
    sessionToken: `sidebar-session-${key}-${run}`,
  }
}

const OWNER = persona('owner')
const EDITOR = persona('editor')
const VIEWER = persona('viewer')
const REQUESTABLE = persona('requestable')
const NO_CHAT = persona('nochat')
const GUEST = persona('guest')
const SOLO = persona('solo')
const INVITEE = persona('invitee')
const SWITCHER = persona('switcher')
const EVERYONE = [OWNER, EDITOR, VIEWER, REQUESTABLE, NO_CHAT, GUEST, SOLO, INVITEE, SWITCHER]
const ORGANIZATION_MEMBERS = [OWNER, EDITOR, VIEWER, REQUESTABLE, NO_CHAT, SWITCHER]
const BRAND_COLOR = '#123456'
const REQUESTABLE_GROUP_ID = `sidebar-group-requestable-${run}`
const NO_CHAT_GROUP_ID = `sidebar-group-nochat-${run}`
/** A non-default group governs only the workspaces it targets, so each workspace links its own. */
const GROUP_BY_PERSONA = new Map([
  [REQUESTABLE.key, REQUESTABLE_GROUP_ID],
  [NO_CHAT.key, NO_CHAT_GROUP_ID],
])

async function seedOrganization() {
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx.insert(user).values(
      EVERYONE.map(({ userId, email, name }) => ({
        id: userId,
        email,
        name,
        normalizedEmail: normalizeEmail(email),
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await tx
      .insert(userStats)
      .values(EVERYONE.map(({ userId }) => ({ id: `${userId}-stats`, userId })))
    await tx.insert(account).values(
      EVERYONE.map(({ userId }) => ({
        id: `${userId}-credential`,
        accountId: userId,
        providerId: 'credential',
        userId,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await tx.insert(organization).values({
      id: ORGANIZATION_ID,
      name: `Sidebar organization ${run}`,
      slug: `sidebar-${run}`,
      orgUsageLimit: '1000',
      whitelabelSettings: { primaryColor: BRAND_COLOR },
      createdAt: now,
    })
    await tx.insert(member).values(
      ORGANIZATION_MEMBERS.map(({ key, userId }) => ({
        id: `sidebar-member-${key}-${run}`,
        userId,
        organizationId: ORGANIZATION_ID,
        role: key === 'owner' ? 'owner' : 'member',
      }))
    )
    await tx.insert(session).values(
      EVERYONE.map(({ key, userId, sessionToken }) => ({
        id: `sidebar-session-row-${key}-${run}`,
        token: sessionToken,
        userId,
        activeOrganizationId: ORGANIZATION_MEMBERS.some((entry) => entry.key === key)
          ? ORGANIZATION_ID
          : null,
        expiresAt: new Date(now.getTime() + 86_400_000),
        createdAt: now,
        updatedAt: now,
      }))
    )
    await tx.insert(subscription).values({
      id: `sidebar-subscription-${run}`,
      plan: 'enterprise',
      referenceId: ORGANIZATION_ID,
      status: 'active',
      seats: 50,
      metadata: { plan: 'enterprise', referenceId: ORGANIZATION_ID, seats: 50, monthlyPrice: 100 },
      periodStart: now,
      periodEnd: new Date(now.getTime() + 30 * 86_400_000),
    })
    await tx.insert(permissionGroup).values([
      {
        id: REQUESTABLE_GROUP_ID,
        organizationId: ORGANIZATION_ID,
        name: 'Restricted, requestable',
        createdBy: OWNER.userId,
        membershipMode: 'explicit',
        config: {
          hideTablesTab: true,
          hideFilesTab: true,
          hideIntegrationsTab: true,
          hideKnowledgeBaseTab: true,
          deniedAccessRequests: ['feature:hideKnowledgeBaseTab'],
        },
      },
      {
        id: NO_CHAT_GROUP_ID,
        organizationId: ORGANIZATION_ID,
        name: 'No chat',
        createdBy: OWNER.userId,
        membershipMode: 'explicit',
        config: { hideCopilot: true, deniedAccessRequests: ['feature:hideCopilot'] },
      },
    ])
    await tx.insert(permissionGroupMember).values([
      {
        id: `sidebar-group-member-requestable-${run}`,
        permissionGroupId: REQUESTABLE_GROUP_ID,
        organizationId: ORGANIZATION_ID,
        userId: REQUESTABLE.userId,
      },
      {
        id: `sidebar-group-member-nochat-${run}`,
        permissionGroupId: NO_CHAT_GROUP_ID,
        organizationId: ORGANIZATION_ID,
        userId: NO_CHAT.userId,
      },
    ])
  })
}

type Access = 'admin' | 'write' | 'read'

interface WorkspaceOptions {
  name?: string
  owner?: Persona
  organizationId?: string | null
  logoUrl?: string
  members?: [Persona, Access][]
}

/** One workspace for one check, so nothing a check does can reorder another's tree. */
async function createWorkspace(options: WorkspaceOptions = {}) {
  const id = generateId()
  const name = options.name ?? unique('Workspace')
  const owner = options.owner ?? OWNER
  const organizationId =
    options.organizationId === undefined ? ORGANIZATION_ID : options.organizationId
  await db.insert(project).values({ id, name, ownerId: owner.userId, organizationId })
  await db.insert(workspace).values({
    id,
    projectId: id,
    name,
    ownerId: owner.userId,
    billedAccountUserId: owner.userId,
    organizationId,
    workspaceMode: organizationId ? 'organization' : 'personal',
    logoUrl: options.logoUrl,
  })
  const members: [Persona, Access][] = [[owner, 'admin'], ...(options.members ?? [])]
  await db.insert(permissions).values(
    members.map(([who, permissionType]) => ({
      id: generateId(),
      userId: who.userId,
      entityType: 'workspace' as const,
      entityId: id,
      permissionType,
    }))
  )
  const groupLinks = members.flatMap(([who]) => {
    const permissionGroupId = GROUP_BY_PERSONA.get(who.key)
    return permissionGroupId && organizationId
      ? [{ id: generateId(), permissionGroupId, workspaceId: id, organizationId }]
      : []
  })
  if (groupLinks.length > 0) await db.insert(permissionGroupWorkspace).values(groupLinks)
  return { id, name, owner }
}

interface WorkflowOptions {
  sortOrder?: number
  folderId?: string | null
  locked?: boolean
  name?: string
}

async function createWorkflow(workspaceId: string, owner: Persona, options: WorkflowOptions = {}) {
  const id = generateId()
  const name = options.name ?? unique('Flow')
  const now = new Date()
  await db.insert(workflow).values({
    id,
    userId: owner.userId,
    workspaceId,
    name,
    sortOrder: options.sortOrder ?? 0,
    folderId: options.folderId ?? null,
    locked: options.locked ?? false,
    lastSynced: now,
    createdAt: now,
    updatedAt: now,
  })
  return { id, name }
}

interface FolderOptions {
  sortOrder?: number
  parentId?: string | null
  name?: string
  locked?: boolean
}

async function createFolder(workspaceId: string, owner: Persona, options: FolderOptions = {}) {
  const id = generateId()
  const name = options.name ?? unique('Folder')
  await db.insert(folder).values({
    id,
    resourceType: 'workflow',
    name,
    userId: owner.userId,
    workspaceId,
    parentId: options.parentId ?? null,
    sortOrder: options.sortOrder ?? 0,
    locked: options.locked ?? false,
  })
  return { id, name }
}

interface ChatOptions {
  /** Read after its last update, so it shows no unread state. */
  read?: boolean
  pinned?: boolean
  ageMinutes?: number
}

async function createChat(workspaceId: string, owner: Persona, options: ChatOptions = {}) {
  const id = generateId()
  const title = unique('Chat')
  const updatedAt = new Date(Date.now() - (options.ageMinutes ?? 0) * 60_000)
  await db.insert(copilotChats).values({
    id,
    userId: owner.userId,
    workspaceId,
    type: 'mothership',
    title,
    pinned: options.pinned ?? false,
    lastSeenAt: options.read ? new Date(updatedAt.getTime() + 60_000) : null,
    updatedAt,
  })
  return { id, title }
}

const workspaceWorkflows = (workspaceId: string) =>
  db
    .select()
    .from(workflow)
    .where(and(eq(workflow.workspaceId, workspaceId), isNull(workflow.archivedAt)))
    .orderBy(asc(workflow.sortOrder), asc(workflow.createdAt))

const workflowRow = async (id: string) =>
  (await db.select().from(workflow).where(eq(workflow.id, id)).limit(1))[0]

const folderDbRow = async (id: string) =>
  (await db.select().from(folder).where(eq(folder.id, id)).limit(1))[0]

const chatDbRow = async (id: string) =>
  (await db.select().from(copilotChats).where(eq(copilotChats.id, id)).limit(1))[0]

async function cookieFor(who: Persona) {
  return encodeURIComponent(
    `${who.sessionToken}.${await makeSignature(who.sessionToken, authSecret)}`
  )
}

interface OpenOptions {
  phone?: boolean
  viewport?: { width: number; height: number }
  collapsed?: boolean
  sidebarWidth?: number
}

const FORCED_REORDER_FAILURE = /^http \S+\/api\/(folders|workflows)\/reorder 500 PUT$/
const HANDLED_RUNTIME = /NEXT_REDIRECT|NEXT_HTTP_ERROR_FALLBACK|Minified React error #419/

async function openContext(who: Persona, options: OpenOptions = {}) {
  clientAddress += 1
  const context = await browser.newContext({
    // Better Auth and the socket token route limit by address.
    extraHTTPHeaders: {
      'x-forwarded-for': `10.1.${Math.floor(clientAddress / 250)}.${clientAddress % 250}`,
    },
    viewport: options.phone ? PHONE : (options.viewport ?? DESKTOP),
    hasTouch: Boolean(options.phone),
    isMobile: Boolean(options.phone),
    acceptDownloads: true,
    reducedMotion: 'reduce',
  })
  await context.addCookies([
    {
      name: 'better-auth.session_token',
      value: await cookieFor(who),
      url: origin,
      httpOnly: true,
      sameSite: 'Lax',
    },
    ...(options.collapsed
      ? [{ name: 'sidebar_collapsed', value: '1', url: origin, sameSite: 'Lax' as const }]
      : []),
  ])
  if (options.sidebarWidth !== undefined) {
    await context.addInitScript((width) => {
      if (localStorage.getItem('sidebar-state') === null)
        localStorage.setItem(
          'sidebar-state',
          JSON.stringify({ state: { sidebarWidth: width }, version: 0 })
        )
    }, options.sidebarWidth)
  }
  return context
}

async function newPage(context: BrowserContext) {
  const page = await context.newPage()
  page.on('pageerror', (error) => {
    if (HANDLED_RUNTIME.test(error.message)) return
    recordUnexpected('runtime', page.url(), `${error.message}\n${error.stack ?? ''}`)
  })
  page.on('response', (response) => {
    if (response.status() < 500) return
    if (!response.url().startsWith(origin)) return
    recordUnexpected('http', response.url(), `${response.status()} ${response.request().method()}`)
  })
  return page
}

async function withPage(
  who: Persona,
  body: (page: Page, context: BrowserContext) => Promise<void>,
  options: OpenOptions = {}
) {
  const context = await openContext(who, options)
  const page = await newPage(context)
  try {
    await body(page, context)
  } catch (error) {
    await page
      .screenshot({ path: resolve(artifactDirectory, `failure-${checks.length + 1}.png`) })
      .catch(() => {})
    throw error
  } finally {
    await context.close().catch(() => {})
  }
}

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Workspace sidebar' })
const tree = (page: Page) => page.getByRole('tree', { name: 'Workflows' })
const row = (page: Page, workflowId: string) => tree(page).locator(`a[href$="/w/${workflowId}"]`)
const folderRow = (page: Page, name: string) =>
  tree(page).getByRole('button', { name: new RegExp(`^${escapeRegExp(name)} folder, `) })
const chatRow = (page: Page, chatId: string) => sidebar(page).locator(`a[href$="/chat/${chatId}"]`)
const navLink = (page: Page, name: string) => sidebar(page).getByRole('link', { name, exact: true })
const menuItem = (page: Page, name: string | RegExp) =>
  page.getByRole('menuitem', { name, exact: typeof name === 'string' })
const dialog = (page: Page, name: string | RegExp) => page.getByRole('dialog', { name })
const palette = (page: Page) => dialog(page, 'Search')
const paletteInput = (page: Page) => palette(page).getByRole('combobox')
const paletteOption = (page: Page, name: string | RegExp) =>
  palette(page).getByRole('option', { name })
const switcher = (page: Page) => sidebar(page).getByRole('button', { name: 'Switch workspace' })

/** Server-rendered rows ignore input until React attaches, and a dropped gesture proves nothing. */
async function waitForHydration(page: Page) {
  await page.waitForFunction(() => {
    const rail = document.querySelector('aside')
    return rail !== null && Object.keys(rail).some((key) => key.startsWith('__reactProps'))
  })
}

async function visit(page: Page, workspaceId: string, route = 'tables') {
  await page.goto(`${origin}/workspace/${workspaceId}/${route}`, { timeout: 120_000 })
  await expect(sidebar(page)).toBeVisible()
  await waitForHydration(page)
}

const pathnameIs = (page: Page, path: string) =>
  expect.poll(() => new URL(page.url()).pathname).toBe(path)

async function pointOf(locator: Locator, where: 'top' | 'middle' | 'bottom') {
  const box = await locator.boundingBox()
  assert(box, 'Drag target has no box')
  const ratio = { top: 0.15, middle: 0.5, bottom: 0.85 }[where]
  return { x: box.x + box.width / 2, y: box.y + box.height * ratio }
}

/** Starts a real native drag: the first small move is what fires `dragstart`. */
async function beginDrag(page: Page, source: Locator) {
  await source.scrollIntoViewIfNeeded()
  const start = await pointOf(source, 'middle')
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 6, start.y + 6, { steps: 4 })
}

async function dragOver(page: Page, target: Locator, where: 'top' | 'middle' | 'bottom') {
  const point = await pointOf(target, where)
  await page.mouse.move(point.x, point.y, { steps: 6 })
  // `dragover` must land on the target twice: the first enters, the second sets the indicator.
  await page.mouse.move(point.x + 1, point.y, { steps: 2 })
}

async function drag(
  page: Page,
  source: Locator,
  target: Locator,
  where: 'top' | 'middle' | 'bottom'
) {
  await beginDrag(page, source)
  await dragOver(page, target, where)
  await page.mouse.up()
}

/** Reorder writes this page sent, so a refused gesture can be shown to have sent none. */
function recordReorders(page: Page) {
  const seen: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().endsWith('/reorder')) seen.push(request.url())
  })
  return seen
}

const renderedOrder = (page: Page) =>
  tree(page)
    .locator('a[href*="/w/"]')
    .evaluateAll((links) =>
      links.map((link) => new URL((link as HTMLAnchorElement).href).pathname.split('/').pop())
    )

async function openRowMenu(page: Page, target: Locator) {
  await target.click({ button: 'right' })
  await expect(page.getByRole('menu').last()).toBeVisible()
}

async function workflowTreeChecks() {
  section('Workflow tree')
  await check('New workflow creates a row, opens the canvas and persists', async () => {
    const { id } = await createWorkspace()
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await sidebar(page).getByRole('button', { name: 'New workflow' }).last().click()
      await expect.poll(async () => (await workspaceWorkflows(id)).length).toBe(1)
      const [created] = await workspaceWorkflows(id)
      await expect(row(page, created.id)).toBeVisible()
      await pathnameIs(page, `/workspace/${id}/w/${created.id}`)
    })
  })
  await check('renaming a workflow row writes the new name', async () => {
    const { id } = await createWorkspace()
    const target = await createWorkflow(id, OWNER)
    const renamed = unique('Renamed')
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await openRowMenu(page, row(page, target.id))
      await menuItem(page, 'Rename').click()
      const input = row(page, target.id).getByRole('textbox')
      await input.fill(renamed)
      await input.press('Enter')
      await expect.poll(async () => (await workflowRow(target.id)).name).toBe(renamed)
      await expect(row(page, target.id)).toContainText(renamed)
    })
  })
  await check('Escape abandons a rename without writing', async () => {
    const { id } = await createWorkspace()
    const target = await createWorkflow(id, OWNER)
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await openRowMenu(page, row(page, target.id))
      await menuItem(page, 'Rename').click()
      const input = row(page, target.id).getByRole('textbox')
      await input.fill('Never saved')
      await input.press('Escape')
      await expect(row(page, target.id)).toContainText(target.name)
      assert.equal((await workflowRow(target.id)).name, target.name)
    })
  })
  await check('duplicating a workflow adds a second row and opens it', async () => {
    const { id } = await createWorkspace()
    const target = await createWorkflow(id, OWNER)
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await openRowMenu(page, row(page, target.id))
      await menuItem(page, 'Duplicate').click()
      await expect.poll(async () => (await workspaceWorkflows(id)).length).toBe(2)
      const copy = (await workspaceWorkflows(id)).find((entry) => entry.id !== target.id)
      assert(copy)
      await expect(row(page, copy.id)).toBeVisible()
      await pathnameIs(page, `/workspace/${id}/w/${copy.id}`)
    })
  })
  await check('deleting a workflow asks first, then archives it', async () => {
    const { id } = await createWorkspace()
    const target = await createWorkflow(id, OWNER)
    const other = await createWorkflow(id, OWNER, { sortOrder: 1 })
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await openRowMenu(page, row(page, target.id))
      await menuItem(page, 'Delete').click()
      const confirm = dialog(page, 'Delete workflow')
      await expect(confirm).toContainText(target.name)
      await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
      await expect.poll(async () => (await workflowRow(target.id)).archivedAt).not.toBeNull()
      await expect(row(page, target.id)).toHaveCount(0)
      await expect(row(page, other.id)).toBeVisible()
    })
  })
  await check('exporting a workflow downloads its JSON', async () => {
    const { id } = await createWorkspace()
    const target = await createWorkflow(id, OWNER)
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await openRowMenu(page, row(page, target.id))
      const download = page.waitForEvent('download')
      await menuItem(page, 'Export').click()
      const file = await download
      assert.equal(file.suggestedFilename(), `${target.name}.json`)
      const path = await file.path()
      assert(readFileSync(path, 'utf8').includes(target.name), 'The export names the workflow')
    })
  })
  notProvable(
    'workflow color',
    'Workflows have no color today: no `color` column on the workflow table, no field in the workflow contracts, and no sidebar control. Nothing to protect; a migration must not add one by accident.'
  )
  await check('Create folder from the section menu adds a workflow folder', async () => {
    const { id } = await createWorkspace()
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await sidebar(page).getByRole('button', { name: 'More actions' }).click()
      await menuItem(page, 'Create folder').click()
      await expect
        .poll(async () =>
          (
            await db
              .select()
              .from(folder)
              .where(and(eq(folder.workspaceId, id), eq(folder.resourceType, 'workflow')))
          ).map(({ name }) => name)
        )
        .toHaveLength(1)
      const [created] = await db.select().from(folder).where(eq(folder.workspaceId, id))
      await expect(folderRow(page, created.name)).toBeVisible()
    })
  })
  await check('renaming a folder writes the new name', async () => {
    const { id } = await createWorkspace()
    const target = await createFolder(id, OWNER)
    const renamed = unique('Renamed-folder')
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await openRowMenu(page, folderRow(page, target.name))
      await menuItem(page, 'Rename').click()
      const input = tree(page).getByRole('textbox')
      await input.fill(renamed)
      await input.press('Enter')
      await expect.poll(async () => (await folderDbRow(target.id)).name).toBe(renamed)
      await expect(folderRow(page, renamed)).toBeVisible()
    })
  })
  await check('deleting a folder archives the workflows inside it', async () => {
    const { id } = await createWorkspace()
    const target = await createFolder(id, OWNER)
    const inside = await createWorkflow(id, OWNER, { folderId: target.id })
    const remaining = await createWorkflow(id, OWNER, { sortOrder: 1 })
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await openRowMenu(page, folderRow(page, target.name))
      await menuItem(page, 'Delete').click()
      await dialog(page, 'Delete folder')
        .getByRole('button', { name: 'Delete', exact: true })
        .click()
      await expect.poll(async () => (await folderDbRow(target.id)).deletedAt).not.toBeNull()
      await expect.poll(async () => (await workflowRow(inside.id)).archivedAt).not.toBeNull()
      await expect(folderRow(page, target.name)).toHaveCount(0)
      assert.equal((await workflowRow(remaining.id)).archivedAt, null)
    })
  })
  await check('delete is refused when it would leave the workspace no workflows', async () => {
    const { id } = await createWorkspace()
    const holder = await createFolder(id, OWNER)
    const only = await createWorkflow(id, OWNER, { folderId: holder.id })
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await openRowMenu(page, folderRow(page, holder.name))
      await expect(menuItem(page, 'Delete')).toBeDisabled()
      await page.keyboard.press('Escape')
      await folderRow(page, holder.name).click()
      await openRowMenu(page, row(page, only.id))
      await expect(menuItem(page, 'Delete')).toBeDisabled()
    })
    assert.equal((await workflowRow(only.id)).archivedAt, null)
  })
  await check('an expanded folder stays expanded across navigation', async () => {
    const { id } = await createWorkspace()
    const target = await createFolder(id, OWNER)
    const inside = await createWorkflow(id, OWNER, { folderId: target.id })
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await expect(row(page, inside.id)).toHaveCount(0)
      await folderRow(page, target.name).click()
      await expect(folderRow(page, target.name)).toHaveAttribute('aria-expanded', 'true')
      await expect(row(page, inside.id)).toBeVisible()
      await navLink(page, 'Logs').click()
      await pathnameIs(page, `/workspace/${id}/logs`)
      await expect(folderRow(page, target.name)).toHaveAttribute('aria-expanded', 'true')
      await expect(row(page, inside.id)).toBeVisible()
      await folderRow(page, target.name).click()
      await expect(row(page, inside.id)).toHaveCount(0)
    })
  })
  await check('reloading on a nested workflow reopens the folders above it', async () => {
    const { id } = await createWorkspace()
    const parent = await createFolder(id, OWNER)
    const child = await createFolder(id, OWNER, { parentId: parent.id })
    const inside = await createWorkflow(id, OWNER, { folderId: child.id })
    await withPage(OWNER, async (page) => {
      await visit(page, id, `w/${inside.id}`)
      await expect(row(page, inside.id)).toBeVisible()
      await expect(folderRow(page, parent.name)).toHaveAttribute('aria-expanded', 'true')
      await expect(folderRow(page, child.name)).toHaveAttribute('aria-expanded', 'true')
    })
  })
  notProvable(
    'expanded folders across a full reload',
    'Not a behavior today: the folder store keeps expansion in memory only, so a reload re-expands only the folders above the open workflow. Left unasserted so that persisting it in the migration does not fail this suite.'
  )
}

async function dragAndDropChecks() {
  section('Drag and drop')
  await check('dropping a workflow above another reorders the siblings', async () => {
    const { id } = await createWorkspace()
    const a = await createWorkflow(id, OWNER, { sortOrder: 0 })
    const b = await createWorkflow(id, OWNER, { sortOrder: 1 })
    const c = await createWorkflow(id, OWNER, { sortOrder: 2 })
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await drag(page, row(page, c.id), row(page, b.id), 'top')
      const expected = [a.id, c.id, b.id]
      await expect
        .poll(async () => (await workspaceWorkflows(id)).map((entry) => entry.id))
        .toEqual(expected)
      await expect.poll(() => renderedOrder(page)).toEqual(expected)
    })
  })
  await check('dropping a workflow on the middle of a folder moves it in', async () => {
    const { id } = await createWorkspace()
    const target = await createFolder(id, OWNER, { sortOrder: 0 })
    const moving = await createWorkflow(id, OWNER, { sortOrder: 1 })
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await drag(page, row(page, moving.id), folderRow(page, target.name), 'middle')
      await expect.poll(async () => (await workflowRow(moving.id)).folderId).toBe(target.id)
    })
  })
  await check('dropping a nested workflow on a root row moves it out', async () => {
    const { id } = await createWorkspace()
    const source = await createFolder(id, OWNER, { sortOrder: 0 })
    const nested = await createWorkflow(id, OWNER, { folderId: source.id })
    const anchor = await createWorkflow(id, OWNER, { sortOrder: 1 })
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await folderRow(page, source.name).click()
      await expect(row(page, nested.id)).toBeVisible()
      await drag(page, row(page, nested.id), row(page, anchor.id), 'middle')
      await expect.poll(async () => (await workflowRow(nested.id)).folderId).toBeNull()
    })
  })
  await check('dropping a folder on another folder nests it', async () => {
    const { id } = await createWorkspace()
    const moving = await createFolder(id, OWNER, { sortOrder: 0 })
    const target = await createFolder(id, OWNER, { sortOrder: 1 })
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await drag(page, folderRow(page, moving.name), folderRow(page, target.name), 'middle')
      await expect.poll(async () => (await folderDbRow(moving.id)).parentId).toBe(target.id)
    })
  })
  await check('dropping a folder inside its own child is refused and writes nothing', async () => {
    const { id } = await createWorkspace()
    const parent = await createFolder(id, OWNER, { sortOrder: 0 })
    const child = await createFolder(id, OWNER, { parentId: parent.id })
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      const reorders = recordReorders(page)
      await folderRow(page, parent.name).click()
      await expect(folderRow(page, child.name)).toBeVisible()
      await drag(page, folderRow(page, parent.name), folderRow(page, child.name), 'middle')
      await sleep(500)
      assert.deepEqual(reorders, [], 'A refused move must send no write')
      assert.equal((await folderDbRow(parent.id)).parentId, null)
      assert.equal((await folderDbRow(child.id)).parentId, parent.id)
    })
  })
  await check('dragging one selected row moves the whole selection', async () => {
    const { id } = await createWorkspace()
    const target = await createFolder(id, OWNER, { sortOrder: 0 })
    const one = await createWorkflow(id, OWNER, { sortOrder: 1 })
    const two = await createWorkflow(id, OWNER, { sortOrder: 2 })
    const stays = await createWorkflow(id, OWNER, { sortOrder: 3 })
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await row(page, one.id).click({ modifiers: ['Shift'] })
      await row(page, two.id).click({ modifiers: ['Shift'] })
      await drag(page, row(page, one.id), folderRow(page, target.name), 'middle')
      await expect.poll(async () => (await workflowRow(one.id)).folderId).toBe(target.id)
      await expect.poll(async () => (await workflowRow(two.id)).folderId).toBe(target.id)
      assert.equal((await workflowRow(stays.id)).folderId, null)
    })
  })
  await check(
    'a half-failed mixed drop says so and rolls the failed half back',
    async () => {
      const { id } = await createWorkspace()
      const target = await createFolder(id, OWNER, { sortOrder: 0 })
      const movingFolder = await createFolder(id, OWNER, { sortOrder: 1 })
      const movingWorkflow = await createWorkflow(id, OWNER, { sortOrder: 2 })
      await withPage(OWNER, async (page) => {
        await visit(page, id)
        await page.route('**/api/folders/reorder', (route) =>
          route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: '{"error":"forced"}',
          })
        )
        await folderRow(page, movingFolder.name).click({ modifiers: [MOD] })
        await row(page, movingWorkflow.id).click({ modifiers: ['Shift'] })
        await drag(page, row(page, movingWorkflow.id), folderRow(page, target.name), 'middle')
        await expect(page.getByText('Only some items moved', { exact: true })).toBeVisible()
        await expect
          .poll(async () => (await workflowRow(movingWorkflow.id)).folderId)
          .toBe(target.id)
        assert.equal((await folderDbRow(movingFolder.id)).parentId, null)
        await expect(folderRow(page, movingFolder.name)).toBeVisible()
      })
    },
    { allow: [FORCED_REORDER_FAILURE] }
  )
  await check(
    'a failed drop says so and leaves every row where it was',
    async () => {
      const { id } = await createWorkspace()
      const target = await createFolder(id, OWNER, { sortOrder: 0 })
      const moving = await createWorkflow(id, OWNER, { sortOrder: 1 })
      await withPage(OWNER, async (page) => {
        await visit(page, id)
        await page.route('**/api/workflows/reorder', (route) =>
          route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: '{"error":"forced"}',
          })
        )
        await drag(page, row(page, moving.id), folderRow(page, target.name), 'middle')
        await expect(page.getByText('Failed to move items', { exact: true })).toBeVisible()
        await expect(row(page, moving.id)).toBeVisible()
        assert.equal((await workflowRow(moving.id)).folderId, null)
      })
    },
    { allow: [FORCED_REORDER_FAILURE] }
  )
  await check('hovering a collapsed folder springs it open and a drop in keeps it', async () => {
    const { id } = await createWorkspace()
    const target = await createFolder(id, OWNER, { sortOrder: 0 })
    const moving = await createWorkflow(id, OWNER, { sortOrder: 1 })
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await beginDrag(page, row(page, moving.id))
      await dragOver(page, folderRow(page, target.name), 'middle')
      await expect(folderRow(page, target.name)).toHaveAttribute('aria-expanded', 'true')
      await page.mouse.up()
      await expect.poll(async () => (await workflowRow(moving.id)).folderId).toBe(target.id)
      await expect(folderRow(page, target.name)).toHaveAttribute('aria-expanded', 'true')
    })
  })
  await check('a folder sprung open by a passing drag closes when the drag ends', async () => {
    const { id } = await createWorkspace()
    const passed = await createFolder(id, OWNER, { sortOrder: 0 })
    const first = await createWorkflow(id, OWNER, { sortOrder: 1 })
    const moving = await createWorkflow(id, OWNER, { sortOrder: 2 })
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await beginDrag(page, row(page, moving.id))
      await dragOver(page, folderRow(page, passed.name), 'middle')
      await expect(folderRow(page, passed.name)).toHaveAttribute('aria-expanded', 'true')
      await dragOver(page, row(page, first.id), 'top')
      await page.mouse.up()
      await expect(folderRow(page, passed.name)).toHaveAttribute('aria-expanded', 'false')
      assert.equal((await workflowRow(moving.id)).folderId, null)
    })
  })
  await check('holding a drag near the bottom edge scrolls the list', async () => {
    const { id } = await createWorkspace()
    const flows: { id: string; name: string }[] = []
    for (let index = 0; index < 40; index += 1)
      flows.push(await createWorkflow(id, OWNER, { sortOrder: index }))
    await withPage(
      OWNER,
      async (page) => {
        await visit(page, id)
        const scrollTop = () =>
          tree(page).evaluate((element) => {
            for (let node = element.parentElement; node; node = node.parentElement) {
              const overflow = getComputedStyle(node).overflowY
              if (
                (overflow === 'auto' || overflow === 'scroll') &&
                node.scrollHeight > node.clientHeight
              )
                return node.scrollTop
            }
            return -1
          })
        await expect.poll(scrollTop).toBe(0)
        const scroller = await tree(page).evaluateHandle((element) => {
          for (let node = element.parentElement; node; node = node.parentElement) {
            const overflow = getComputedStyle(node).overflowY
            if (
              (overflow === 'auto' || overflow === 'scroll') &&
              node.scrollHeight > node.clientHeight
            )
              return node
          }
          return element
        })
        const box = await scroller.asElement()?.boundingBox()
        assert(box, 'The list has no scroll box')
        await beginDrag(page, row(page, flows[0].id))
        await page.mouse.move(box.x + box.width / 2, box.y + box.height - 8, { steps: 6 })
        await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height - 8, { steps: 2 })
        await expect.poll(scrollTop).toBeGreaterThan(40)
        await page.mouse.up()
      },
      { viewport: { width: 1280, height: 720 } }
    )
  })
  await check('a viewer cannot drag: no write, no move, and creation is disabled', async () => {
    const { id } = await createWorkspace({ members: [[VIEWER, 'read']] })
    const a = await createWorkflow(id, OWNER, { sortOrder: 0 })
    const b = await createWorkflow(id, OWNER, { sortOrder: 1 })
    await withPage(VIEWER, async (page) => {
      await visit(page, id)
      const reorders = recordReorders(page)
      await drag(page, row(page, b.id), row(page, a.id), 'top')
      await sleep(500)
      assert.deepEqual(reorders, [])
      assert.deepEqual(
        (await workspaceWorkflows(id)).map((entry) => entry.id),
        [a.id, b.id]
      )
      await expect(
        sidebar(page).getByRole('button', { name: 'New workflow' }).last()
      ).toBeDisabled()
      await expect(sidebar(page).getByRole('button', { name: 'More actions' })).toBeDisabled()
    })
  })
  await check(
    'a locked workflow does not drag, and neither does one in a locked folder',
    async () => {
      const { id } = await createWorkspace()
      const a = await createWorkflow(id, OWNER, { sortOrder: 0 })
      const locked = await createWorkflow(id, OWNER, { sortOrder: 1, locked: true })
      const lockedFolder = await createFolder(id, OWNER, { sortOrder: 2, locked: true })
      const inherited = await createWorkflow(id, OWNER, { folderId: lockedFolder.id })
      await withPage(OWNER, async (page) => {
        await visit(page, id)
        const reorders = recordReorders(page)
        await drag(page, row(page, locked.id), row(page, a.id), 'top')
        await folderRow(page, lockedFolder.name).click()
        await drag(page, row(page, inherited.id), row(page, a.id), 'top')
        await sleep(500)
        assert.deepEqual(reorders, [])
        assert.equal((await workflowRow(inherited.id)).folderId, lockedFolder.id)
        await expect(
          row(page, locked.id).getByRole('img', { name: 'Workflow is locked' })
        ).toBeVisible()
      })
    }
  )
}

async function multiSelectChecks() {
  section('Multi-select')
  await check('shift-click collects workflows, and the menu acts on all of them', async () => {
    const { id } = await createWorkspace()
    const one = await createWorkflow(id, OWNER, { sortOrder: 0 })
    const two = await createWorkflow(id, OWNER, { sortOrder: 1 })
    const three = await createWorkflow(id, OWNER, { sortOrder: 2 })
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await row(page, one.id).click({ modifiers: ['Shift'] })
      await row(page, three.id).click({ modifiers: ['Shift'] })
      await pathnameIs(page, `/workspace/${id}/tables`)
      await openRowMenu(page, row(page, three.id))
      await menuItem(page, 'Delete 2 items').click()
      const confirm = dialog(page, 'Delete workflows')
      await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
      await expect.poll(async () => (await workflowRow(one.id)).archivedAt).not.toBeNull()
      await expect.poll(async () => (await workflowRow(three.id)).archivedAt).not.toBeNull()
      assert.equal((await workflowRow(two.id)).archivedAt, null)
    })
  })
  await check('shift-click from the open workflow selects the whole range', async () => {
    const { id } = await createWorkspace()
    const one = await createWorkflow(id, OWNER, { sortOrder: 0 })
    await createWorkflow(id, OWNER, { sortOrder: 1 })
    const three = await createWorkflow(id, OWNER, { sortOrder: 2 })
    await withPage(OWNER, async (page) => {
      await visit(page, id, `w/${one.id}`)
      await expect(row(page, three.id)).toBeVisible()
      await row(page, three.id).click({ modifiers: ['Shift'] })
      await pathnameIs(page, `/workspace/${id}/w/${one.id}`)
      await openRowMenu(page, row(page, three.id))
      await expect(menuItem(page, 'Delete 3 items')).toBeVisible()
    })
  })
  await check('mod-click on a workflow opens a new tab rather than selecting', async () => {
    const { id } = await createWorkspace()
    const one = await createWorkflow(id, OWNER)
    await withPage(OWNER, async (page, context) => {
      await visit(page, id)
      const popup = context.waitForEvent('page')
      await row(page, one.id).click({ modifiers: [MOD] })
      const tab = await popup
      await expect.poll(() => new URL(tab.url()).pathname).toBe(`/workspace/${id}/w/${one.id}`)
      await tab.close()
      await pathnameIs(page, `/workspace/${id}/tables`)
    })
  })
  await check('bulk duplicate copies every selected workflow', async () => {
    const { id } = await createWorkspace()
    const one = await createWorkflow(id, OWNER, { sortOrder: 0 })
    const two = await createWorkflow(id, OWNER, { sortOrder: 1 })
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await row(page, one.id).click({ modifiers: ['Shift'] })
      await row(page, two.id).click({ modifiers: ['Shift'] })
      await openRowMenu(page, row(page, two.id))
      await menuItem(page, 'Duplicate 2 items').click()
      await expect.poll(async () => (await workspaceWorkflows(id)).length).toBe(4)
    })
  })
  await check('bulk export downloads one archive', async () => {
    const { id } = await createWorkspace()
    const one = await createWorkflow(id, OWNER, { sortOrder: 0 })
    const two = await createWorkflow(id, OWNER, { sortOrder: 1 })
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await row(page, one.id).click({ modifiers: ['Shift'] })
      await row(page, two.id).click({ modifiers: ['Shift'] })
      await openRowMenu(page, row(page, two.id))
      const download = page.waitForEvent('download')
      await menuItem(page, 'Export 2 items').click()
      assert.match((await download).suggestedFilename(), /\.zip$/)
    })
  })
  await check(
    'mod and shift click select folders, and a mixed delete takes all of it',
    async () => {
      const { id } = await createWorkspace()
      const a = await createFolder(id, OWNER, { sortOrder: 0 })
      const b = await createFolder(id, OWNER, { sortOrder: 1 })
      const c = await createFolder(id, OWNER, { sortOrder: 2 })
      const flow = await createWorkflow(id, OWNER, { sortOrder: 3 })
      const remaining = await createWorkflow(id, OWNER, { sortOrder: 4 })
      await withPage(OWNER, async (page) => {
        await visit(page, id)
        await folderRow(page, a.name).click({ modifiers: [MOD] })
        await folderRow(page, c.name).click({ modifiers: ['Shift'] })
        await row(page, flow.id).click({ modifiers: ['Shift'] })
        await expect(folderRow(page, a.name)).toHaveAttribute('aria-expanded', 'false')
        await openRowMenu(page, folderRow(page, b.name))
        await menuItem(page, 'Delete 4 items').click()
        await dialog(page, 'Delete items')
          .getByRole('button', { name: 'Delete', exact: true })
          .click()
        await expect.poll(async () => (await folderDbRow(a.id)).deletedAt).not.toBeNull()
        await expect.poll(async () => (await folderDbRow(b.id)).deletedAt).not.toBeNull()
        await expect.poll(async () => (await folderDbRow(c.id)).deletedAt).not.toBeNull()
        await expect.poll(async () => (await workflowRow(flow.id)).archivedAt).not.toBeNull()
        assert.equal((await workflowRow(remaining.id)).archivedAt, null)
      })
    }
  )
  await check('selecting a folder drops a selected workflow inside it', async () => {
    const { id } = await createWorkspace()
    const parent = await createFolder(id, OWNER, { sortOrder: 0 })
    const inside = await createWorkflow(id, OWNER, { folderId: parent.id })
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await folderRow(page, parent.name).click()
      await row(page, inside.id).click({ modifiers: ['Shift'] })
      await folderRow(page, parent.name).click({ modifiers: [MOD] })
      await openRowMenu(page, folderRow(page, parent.name))
      await expect(menuItem(page, 'Delete')).toBeVisible()
    })
  })
  await check('clicking the sidebar background clears the selection', async () => {
    const { id } = await createWorkspace()
    const one = await createWorkflow(id, OWNER, { sortOrder: 0 })
    const two = await createWorkflow(id, OWNER, { sortOrder: 1 })
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await row(page, one.id).click({ modifiers: ['Shift'] })
      await row(page, two.id).click({ modifiers: ['Shift'] })
      const box = await tree(page).boundingBox()
      assert(box, 'The tree has no box')
      await page.mouse.click(box.x + box.width / 2, box.y + box.height + 10)
      await openRowMenu(page, row(page, two.id))
      await expect(menuItem(page, 'Delete')).toBeVisible()
      await expect(menuItem(page, 'Delete 2 items')).toHaveCount(0)
    })
  })
  await check('shift-click selects a chat range, and bulk delete archives it', async () => {
    const { id } = await createWorkspace()
    const one = await createChat(id, OWNER, { ageMinutes: 1 })
    const two = await createChat(id, OWNER, { ageMinutes: 2 })
    const three = await createChat(id, OWNER, { ageMinutes: 3 })
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await chatRow(page, one.id).click({ modifiers: ['Shift'] })
      await chatRow(page, three.id).click({ modifiers: ['Shift'] })
      await pathnameIs(page, `/workspace/${id}/tables`)
      await openRowMenu(page, chatRow(page, two.id))
      await menuItem(page, 'Delete 3 items').click()
      const confirm = dialog(page, 'Delete chats')
      await expect(confirm).toContainText('3 chats')
      await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
      for (const chat of [one, two, three])
        await expect.poll(async () => (await chatDbRow(chat.id)).deletedAt).not.toBeNull()
      await expect(chatRow(page, one.id)).toHaveCount(0)
    })
  })
  await check('mod-click on a chat opens a new tab rather than selecting', async () => {
    const { id } = await createWorkspace()
    const chat = await createChat(id, OWNER)
    await withPage(OWNER, async (page, context) => {
      await visit(page, id)
      const popup = context.waitForEvent('page')
      await chatRow(page, chat.id).click({ modifiers: [MOD] })
      const tab = await popup
      await expect.poll(() => new URL(tab.url()).pathname).toBe(`/workspace/${id}/chat/${chat.id}`)
      await tab.close()
    })
  })
}

async function workspaceHeaderChecks() {
  section('Workspace header')
  await check('the switcher lists my workspaces and moves between them', async () => {
    const a = await createWorkspace({ owner: EDITOR, name: unique('Switch-a') })
    const b = await createWorkspace({ owner: EDITOR, name: unique('Switch-b') })
    await withPage(EDITOR, async (page) => {
      await visit(page, a.id)
      await expect(switcher(page)).toContainText(a.name)
      await switcher(page).click()
      await menuItem(page, new RegExp(escapeRegExp(b.name))).click()
      await expect.poll(() => new URL(page.url()).pathname).toContain(`/workspace/${b.id}`)
      await expect(switcher(page)).toContainText(b.name)
    })
  })
  await check('the keyboard filters a long list and Enter switches', async () => {
    const names = [1, 2, 3, 4, 5, 6].map((index) => unique(`Long-${index}`))
    const created: { id: string; name: string }[] = []
    for (const name of names) created.push(await createWorkspace({ owner: SWITCHER, name }))
    await withPage(SWITCHER, async (page) => {
      await visit(page, created[0].id)
      await switcher(page).click()
      const filter = page.getByPlaceholder('Search workspaces...')
      await expect(filter).toBeFocused()
      await filter.fill(names[4])
      await expect(menuItem(page, new RegExp(escapeRegExp(names[4])))).toBeVisible()
      await expect(menuItem(page, new RegExp(escapeRegExp(names[1])))).toHaveCount(0)
      await filter.press('Enter')
      await expect.poll(() => new URL(page.url()).pathname).toContain(`/workspace/${created[4].id}`)
      await switcher(page).click()
      const reopened = page.getByPlaceholder('Search workspaces...')
      await expect(reopened).toHaveValue('')
      await reopened.fill('nothing-matches-this')
      await expect(page.getByText('No results for "nothing-matches-this"')).toBeVisible()
    })
  })
  await check('pinning a workspace persists and lifts it to the top', async () => {
    const first = await createWorkspace({ owner: VIEWER, name: unique('Pin-a') })
    const second = await createWorkspace({ owner: VIEWER, name: unique('Pin-b') })
    await withPage(VIEWER, async (page) => {
      await visit(page, first.id)
      await switcher(page).click()
      const target = menuItem(page, new RegExp(escapeRegExp(second.name)))
      await target.click({ button: 'right' })
      await menuItem(page, 'Pin').click()
      await expect
        .poll(
          async () =>
            (
              await db
                .select()
                .from(pinnedItem)
                .where(
                  and(eq(pinnedItem.userId, VIEWER.userId), eq(pinnedItem.resourceId, second.id))
                )
            ).length
        )
        .toBe(1)
      await expect(page.getByRole('menu').getByRole('img', { name: 'Pinned' })).toHaveCount(1)
      await expect
        .poll(async () => {
          const rows = await page.getByRole('menuitem').allInnerTexts()
          return (
            rows.findIndex((text) => text.includes(second.name)) <
            rows.findIndex((text) => text.includes(first.name))
          )
        })
        .toBe(true)
    })
  })
  await check('a new workspace from the switcher is created and opened', async () => {
    const start = await createWorkspace()
    const name = unique('Created')
    await withPage(OWNER, async (page) => {
      await visit(page, start.id)
      await switcher(page).click()
      await menuItem(page, 'New workspace').click()
      const modal = dialog(page, 'Create workspace')
      await modal.getByPlaceholder('Workspace name').fill(name)
      await modal.getByRole('button', { name: 'Create', exact: true }).click()
      await expect
        .poll(
          async () => (await db.select().from(workspace).where(eq(workspace.name, name))).length
        )
        .toBe(1)
      const [created] = await db.select().from(workspace).where(eq(workspace.name, name))
      await expect.poll(() => new URL(page.url()).pathname).toContain(`/workspace/${created.id}`)
    })
  })
  await check('an admin renames a workspace in place', async () => {
    const { id, name } = await createWorkspace()
    const renamed = unique('Renamed-workspace')
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await switcher(page).click()
      await menuItem(page, new RegExp(escapeRegExp(name))).click({ button: 'right' })
      await menuItem(page, 'Rename').click()
      const input = page.getByRole('textbox', { name: `Rename workspace ${name}` })
      await input.fill(renamed)
      await input.press('Enter')
      await expect
        .poll(async () => (await db.select().from(workspace).where(eq(workspace.id, id)))[0].name)
        .toBe(renamed)
    })
  })
  await check('a viewer cannot rename, and cannot invite', async () => {
    const { id, name } = await createWorkspace({ members: [[VIEWER, 'read']] })
    await withPage(VIEWER, async (page) => {
      await visit(page, id)
      await switcher(page).click()
      await expect(menuItem(page, 'Invite teammates')).toHaveCount(0)
      await menuItem(page, new RegExp(escapeRegExp(name))).click({ button: 'right' })
      await expect(menuItem(page, 'Rename')).toBeDisabled()
    })
  })
  await check('an organization admin can open the invite form', async () => {
    const { id } = await createWorkspace()
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await switcher(page).click()
      await menuItem(page, 'Invite teammates').click()
      await expect(dialog(page, /^Invite teammates to /)).toBeVisible()
    })
  })
  await check('a personal workspace on a free plan is sent to billing to invite', async () => {
    const { id } = await createWorkspace({ owner: SOLO, organizationId: null })
    await withPage(SOLO, async (page) => {
      await visit(page, id)
      await switcher(page).click()
      await menuItem(page, 'Invite teammates').click()
      await pathnameIs(page, `/workspace/${id}/settings/billing`)
      await expect(dialog(page, /^Invite teammates to /)).toHaveCount(0)
    })
  })
  await check('an uploaded workspace logo marks the switcher and its rows', async () => {
    const logoUrl = `${origin}/favicon.ico?workspace=${run}`
    const { id, name } = await createWorkspace({ logoUrl })
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await expect(switcher(page).locator(`img[src="${logoUrl}"]`)).toBeVisible()
      await switcher(page).click()
      await expect(
        menuItem(page, new RegExp(escapeRegExp(name))).locator(`img[src="${logoUrl}"]`)
      ).toBeVisible()
    })
  })
  await check('the host organization white-label color reaches a member', async () => {
    const { id } = await createWorkspace()
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await expect
        .poll(() =>
          page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--brand-accent').trim()
          )
        )
        .toBe(BRAND_COLOR)
    })
  })
  await check('a pending invitation shows in the switcher and can be declined', async () => {
    const home = await createWorkspace({ owner: INVITEE, organizationId: null })
    const invited = await createWorkspace({
      owner: SOLO,
      organizationId: null,
      name: unique('Invited-decline'),
    })
    await seedInvitation(invited.id)
    await withPage(INVITEE, async (page) => {
      await visit(page, home.id)
      await switcher(page).click()
      await menuItem(page, 'View invitations').click()
      const modal = dialog(page, 'Pending invitations')
      const entry = modal.getByRole('region', { name: `Invitation to ${invited.name}` })
      await entry.getByRole('button', { name: `Decline invitation to ${invited.name}` }).click()
      await expect(entry).toHaveCount(0)
      await expect
        .poll(
          async () =>
            (
              await db
                .select({ id: invitationWorkspaceGrant.id })
                .from(invitationWorkspaceGrant)
                .innerJoin(invitation, eq(invitation.id, invitationWorkspaceGrant.invitationId))
                .where(
                  and(
                    eq(invitationWorkspaceGrant.workspaceId, invited.id),
                    eq(invitation.status, 'pending')
                  )
                )
            ).length
        )
        .toBe(0)
    })
  })
  await check('accepting an invitation grants access and opens the workspace', async () => {
    const home = await createWorkspace({ owner: INVITEE, organizationId: null })
    const invited = await createWorkspace({
      owner: SOLO,
      organizationId: null,
      name: unique('Invited-accept'),
    })
    await seedInvitation(invited.id)
    await withPage(INVITEE, async (page) => {
      await visit(page, home.id)
      await switcher(page).click()
      await menuItem(page, 'View invitations').click()
      const entry = dialog(page, 'Pending invitations').getByRole('region', {
        name: `Invitation to ${invited.name}`,
      })
      await entry.getByRole('button', { name: 'Accept', exact: true }).click()
      await expect.poll(() => new URL(page.url()).pathname).toContain(`/workspace/${invited.id}`)
      await expect
        .poll(
          async () =>
            (
              await db
                .select()
                .from(permissions)
                .where(
                  and(eq(permissions.userId, INVITEE.userId), eq(permissions.entityId, invited.id))
                )
            ).length
        )
        .toBe(1)
    })
  })
  await check('a guest gets the sidebar with no way back to an organization', async () => {
    const { id } = await createWorkspace({ members: [[GUEST, 'read']] })
    const flow = await createWorkflow(id, OWNER)
    await withPage(GUEST, async (page) => {
      await visit(page, id)
      await expect(row(page, flow.id)).toBeVisible()
      await switcher(page).click()
      await expect(menuItem(page, 'Back to organization')).toHaveCount(0)
      await expect(menuItem(page, 'Invite teammates')).toHaveCount(0)
    })
  })
  await check('an organization member can go back to the organization', async () => {
    const { id } = await createWorkspace()
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await switcher(page).click()
      await menuItem(page, 'Back to organization').click()
      await expect.poll(() => new URL(page.url()).pathname).toContain(`/o/${ORGANIZATION_ID}`)
    })
  })
  await check('a workspace with no organization has a working sidebar', async () => {
    const { id } = await createWorkspace({ owner: SOLO, organizationId: null })
    const flow = await createWorkflow(id, SOLO)
    await withPage(SOLO, async (page) => {
      await visit(page, id)
      await expect(row(page, flow.id)).toBeVisible()
      await expect(navLink(page, 'Tables')).toBeVisible()
      await switcher(page).click()
      await expect(menuItem(page, 'Back to organization')).toHaveCount(0)
    })
  })
}

async function seedInvitation(workspaceId: string) {
  const id = generateId()
  await db.insert(invitation).values({
    id,
    kind: 'workspace',
    email: INVITEE.email,
    inviterId: SOLO.userId,
    organizationId: null,
    membershipIntent: 'external',
    role: 'member',
    status: 'pending',
    token: generateId(),
    expiresAt: new Date(Date.now() + 86_400_000),
  })
  await db.insert(invitationWorkspaceGrant).values({
    id: generateId(),
    invitationId: id,
    workspaceId,
    permission: 'read',
  })
}

async function chatChecks() {
  section('Chats')
  await check('chats list newest first with pinned on top', async () => {
    const { id } = await createWorkspace()
    const older = await createChat(id, OWNER, { ageMinutes: 30, read: true })
    const newer = await createChat(id, OWNER, { ageMinutes: 1, read: true })
    const pinned = await createChat(id, OWNER, { ageMinutes: 60, read: true, pinned: true })
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      const links = sidebar(page).locator('a[href*="/chat/"]')
      await expect(links).toHaveCount(3)
      const hrefs = await links.evaluateAll((anchors) =>
        anchors.map((link) => (link as HTMLAnchorElement).href.split('/').pop())
      )
      assert.deepEqual(hrefs, [pinned.id, newer.id, older.id])
    })
  })
  await check('an unread chat offers Mark as read, which writes last seen', async () => {
    const { id } = await createWorkspace()
    const unread = await createChat(id, OWNER, { read: false })
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await openRowMenu(page, chatRow(page, unread.id))
      await expect(menuItem(page, 'Mark as unread')).toHaveCount(0)
      await menuItem(page, 'Mark as read').click()
      await expect.poll(async () => (await chatDbRow(unread.id)).lastSeenAt).not.toBeNull()
      await openRowMenu(page, chatRow(page, unread.id))
      await expect(menuItem(page, 'Mark as unread')).toBeVisible()
    })
  })
  await check('a read chat can be marked unread again', async () => {
    const { id } = await createWorkspace()
    const read = await createChat(id, OWNER, { read: true })
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await openRowMenu(page, chatRow(page, read.id))
      await menuItem(page, 'Mark as unread').click()
      await page.keyboard.press('Escape')
      await openRowMenu(page, chatRow(page, read.id))
      await expect(menuItem(page, 'Mark as read')).toBeVisible()
    })
  })
  notProvable(
    'unread and activity dot visuals',
    'Both dots are `aria-hidden` with no role, so their presence is only readable through class names, which this suite never asserts. Unread state is covered through the row menu; a running chat needs a stream marker the worker writes to Redis. The desktop activity dot does expose `role="img"`, but needs a registered desktop executor, covered by `test-desktop-inbox-e2e.ts`.'
  )
  await check('renaming a chat writes the title', async () => {
    const { id } = await createWorkspace()
    const chat = await createChat(id, OWNER, { read: true })
    const renamed = unique('Renamed-chat')
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await openRowMenu(page, chatRow(page, chat.id))
      await menuItem(page, 'Rename').click()
      const input = sidebar(page).getByRole('textbox')
      await input.fill(renamed)
      await input.press('Enter')
      await expect.poll(async () => (await chatDbRow(chat.id)).title).toBe(renamed)
      await expect(chatRow(page, chat.id)).toContainText(renamed)
    })
  })
  await check('deleting the open chat archives it and returns to Home', async () => {
    const { id } = await createWorkspace()
    const chat = await createChat(id, OWNER, { read: true })
    await withPage(OWNER, async (page) => {
      await visit(page, id, `chat/${chat.id}`)
      await openRowMenu(page, chatRow(page, chat.id))
      await menuItem(page, 'Delete').click()
      await dialog(page, 'Delete chat').getByRole('button', { name: 'Delete', exact: true }).click()
      await expect.poll(async () => (await chatDbRow(chat.id)).deletedAt).not.toBeNull()
      await pathnameIs(page, `/workspace/${id}/home`)
    })
  })
  await check('a viewer can read a chat list but not rename or delete', async () => {
    const { id } = await createWorkspace({ members: [[VIEWER, 'read']] })
    const chat = await createChat(id, VIEWER, { read: true })
    await withPage(VIEWER, async (page) => {
      await visit(page, id)
      await openRowMenu(page, chatRow(page, chat.id))
      await expect(menuItem(page, 'Rename')).toBeDisabled()
      await expect(menuItem(page, 'Delete')).toBeDisabled()
    })
  })
  await check('See more reveals the rest and See less folds them back', async () => {
    const { id } = await createWorkspace()
    const chats: { id: string; title: string }[] = []
    for (let index = 0; index < 8; index += 1)
      chats.push(await createChat(id, OWNER, { read: true, ageMinutes: index }))
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      const links = sidebar(page).locator('a[href*="/chat/"]')
      await expect(links).toHaveCount(5)
      await sidebar(page).getByRole('button', { name: 'See more', exact: true }).click()
      await expect(links).toHaveCount(8)
      await sidebar(page).getByRole('button', { name: 'See less', exact: true }).click()
      await expect(links).toHaveCount(5)
      await expect(chatRow(page, chats[7].id)).toHaveCount(0)
    })
  })
}

async function navGatingChecks() {
  section('Nav gating')
  await check('an unrestricted admin sees every default entry, unlocked', async () => {
    const { id } = await createWorkspace()
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      for (const name of ['New chat', 'Integrations', 'Tables', 'Files', 'Knowledge bases', 'Logs'])
        await expect(navLink(page, name)).toBeVisible()
    })
  })
  await check('the seeded restriction reaches the policy read the sidebar uses', async () => {
    const { id } = await createWorkspace({ members: [[REQUESTABLE, 'write']] })
    const context = await openContext(REQUESTABLE)
    try {
      const response = await context.request.get(
        `${origin}/api/permission-groups/user?workspaceId=${id}`
      )
      assert.equal(response.status(), 200)
      const policy = (await response.json()) as {
        permissionGroupId: string | null
        config: { hideTablesTab: boolean } | null
      }
      assert.equal(policy.permissionGroupId, REQUESTABLE_GROUP_ID)
      assert.equal(policy.config?.hideTablesTab, true)
    } finally {
      await context.close().catch(() => {})
    }
  })
  await check('a requestable restriction keeps the entry, marked access required', async () => {
    const { id } = await createWorkspace({ members: [[REQUESTABLE, 'write']] })
    await withPage(REQUESTABLE, async (page) => {
      await visit(page, id, 'logs')
      for (const name of ['Tables', 'Files', 'Integrations']) {
        await expect(navLink(page, `${name}: access required`)).toBeVisible()
        await expect(navLink(page, name)).toHaveCount(0)
      }
      await navLink(page, 'Tables: access required').click()
      await pathnameIs(page, `/workspace/${id}/tables`)
      await expect(page.getByText('Access required', { exact: true }).first()).toBeVisible()
    })
  })
  await check('a restriction closed to requests removes the entry', async () => {
    const { id } = await createWorkspace({ members: [[REQUESTABLE, 'write']] })
    await withPage(REQUESTABLE, async (page) => {
      await visit(page, id, 'logs')
      await expect(navLink(page, 'Knowledge bases')).toHaveCount(0)
      await expect(navLink(page, 'Knowledge bases: access required')).toHaveCount(0)
    })
  })
  await check('hiding Copilot removes New chat and the Chats section', async () => {
    const { id } = await createWorkspace({ members: [[NO_CHAT, 'write']] })
    await createChat(id, NO_CHAT)
    await withPage(NO_CHAT, async (page) => {
      await visit(page, id)
      await expect(navLink(page, 'New chat')).toHaveCount(0)
      await expect(sidebar(page).getByRole('button', { name: 'Chats' })).toHaveCount(0)
      await expect(sidebar(page).locator('a[href*="/chat/"]')).toHaveCount(0)
    })
  })
  await check('a restricted entry never paints, even for a frame during load', async () => {
    const { id } = await createWorkspace({ members: [[REQUESTABLE, 'write']] })
    await withPage(REQUESTABLE, async (page, context) => {
      await context.addInitScript(() => {
        const painted: string[] = []
        Object.assign(window, { paintedLinks: painted })
        const sample = () => {
          for (const link of document.querySelectorAll('aside a[href$="/knowledge"]'))
            painted.push(link.getAttribute('href') ?? '')
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
      await visit(page, id, 'logs')
      await expect(navLink(page, 'Logs')).toBeVisible()
      await sleep(1_000)
      assert.deepEqual(
        await page.evaluate(() => (window as unknown as { paintedLinks: string[] }).paintedLinks),
        []
      )
    })
  })
  await check('a requestable page offers to ask for access', async () => {
    const { id } = await createWorkspace({ members: [[REQUESTABLE, 'write']] })
    await withPage(REQUESTABLE, async (page) => {
      await visit(page, id, 'logs')
      await navLink(page, 'Files: access required').click()
      await expect(
        page.getByText('Ask an administrator for access.', { exact: true })
      ).toBeVisible()
    })
  })
  notProvable(
    'nav gating before the policy has loaded on the client',
    'Unreachable in a healthy run: the layout seeds the policy into the first render, so there is no unloaded window to observe. It takes a failed server read, and the DB trick that forces one also breaks the client read. Reading the code, `usePermissionConfig` falls back to `DEFAULT_PERMISSION_GROUP_CONFIG` while unloaded, so the nav FAILS OPEN in that window; only `useIntegrationAccess` fails closed. Reported to the owner as a finding.'
  )
  await check('dashboard, tests and changelog stay off without their flags', async () => {
    const { id } = await createWorkspace()
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      for (const name of ['Dashboard', 'Tests', 'Changelog'])
        await expect(navLink(page, name)).toHaveCount(0)
    })
  })
}

async function chromeChecks() {
  section('Collapse, resize and peek')
  const width = (page: Page) => sidebar(page).evaluate((rail) => rail.getBoundingClientRect().width)
  await check('collapsing shrinks the rail, writes the cookie and survives reload', async () => {
    const { id } = await createWorkspace()
    await withPage(OWNER, async (page, context) => {
      await visit(page, id)
      await sidebar(page).getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
      await expect.poll(() => width(page)).toBeLessThan(100)
      await expect(tree(page)).toHaveCount(0)
      const cookie = (await context.cookies()).find((entry) => entry.name === 'sidebar_collapsed')
      assert.equal(cookie?.value, '1')
      await page.reload()
      await expect(sidebar(page)).toBeVisible()
      await waitForHydration(page)
      await expect.poll(() => width(page)).toBeLessThan(100)
      await sidebar(page).getByRole('button', { name: 'Expand sidebar', exact: true }).click()
      await expect.poll(() => width(page)).toBeGreaterThan(100)
      await expect(tree(page)).toBeVisible()
    })
  })
  await check('dragging the edge resizes, and the width survives reload', async () => {
    const { id } = await createWorkspace()
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      const handle = page.getByRole('separator', { name: 'Resize sidebar' })
      // The rail's shell clips the handle at its own edge, so only its left half can be grabbed.
      const box = await handle.boundingBox()
      assert(box, 'The resize handle has no box')
      const point = { x: box.x + 2, y: box.y + box.height / 2 }
      await page.mouse.move(point.x, point.y)
      await page.mouse.down()
      await page.mouse.move(360, point.y, { steps: 6 })
      await page.mouse.up()
      await expect.poll(() => width(page)).toBeCloseTo(360, -1)
      await page.reload()
      await expect(sidebar(page)).toBeVisible()
      await expect.poll(() => width(page)).toBeCloseTo(360, -1)
    })
  })
  const trackWidths = async (context: BrowserContext) => {
    await context.addInitScript(() => {
      const widths: number[] = []
      Object.assign(window, { railWidths: widths })
      const sample = () => {
        const rail = document.querySelector('aside')
        if (rail) widths.push(Math.round(rail.getBoundingClientRect().width))
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
  }
  const recordedWidths = (page: Page) =>
    page.evaluate(() => (window as unknown as { railWidths: number[] }).railWidths)
  await check('a saved width loads without flashing another width', async () => {
    const { id } = await createWorkspace()
    await withPage(
      OWNER,
      async (page, context) => {
        await trackWidths(context)
        await visit(page, id)
        await sleep(500)
        const widths = await recordedWidths(page)
        assert(widths.length > 0, 'The rail was never sampled')
        const expanded = widths.filter((entry) => entry > 0)
        assert(
          expanded.every((entry) => Math.abs(entry - 380) <= 2),
          `The rail flashed other widths: ${[...new Set(expanded)].join(', ')}`
        )
      },
      { sidebarWidth: 380 }
    )
  })
  await check('a collapsed rail loads collapsed, without flashing open', async () => {
    const { id } = await createWorkspace()
    await withPage(
      OWNER,
      async (page, context) => {
        await trackWidths(context)
        await visit(page, id)
        await sleep(500)
        const widths = await recordedWidths(page)
        assert(widths.length > 0, 'The rail was never sampled')
        assert(
          widths.every((entry) => entry < 100),
          `The collapsed rail flashed open: ${[...new Set(widths)].join(', ')}`
        )
      },
      { collapsed: true }
    )
  })
  await check('a collapsed rail still reaches workflows through its flyout', async () => {
    const { id } = await createWorkspace()
    const flow = await createWorkflow(id, OWNER)
    await withPage(
      OWNER,
      async (page) => {
        await visit(page, id)
        await sidebar(page).getByRole('button', { name: 'Workflows', exact: true }).hover()
        const link = page.locator(`a[href$="/w/${flow.id}"]`)
        await expect(link).toBeVisible()
        await link.click()
        await pathnameIs(page, `/workspace/${id}/w/${flow.id}`)
      },
      { collapsed: true }
    )
  })
  await check('Mod+B toggles the rail', async () => {
    const { id } = await createWorkspace()
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await page.keyboard.press(`${MOD}+b`)
      await expect.poll(() => width(page)).toBeLessThan(100)
      await page.keyboard.press(`${MOD}+b`)
      await expect.poll(() => width(page)).toBeGreaterThan(100)
    })
  })
  await check(
    'the phone drawer opens, navigates, closes and leaves desktop state alone',
    async () => {
      const { id } = await createWorkspace()
      await withPage(
        OWNER,
        async (page, context) => {
          await page.goto(`${origin}/workspace/${id}/tables`, { timeout: 120_000 })
          const open = page.getByRole('button', { name: 'Open navigation', exact: true })
          await expect(open).toBeVisible()
          await waitForHydration(page)
          await expect(sidebar(page)).toBeHidden()
          await open.tap()
          await expect(sidebar(page)).toBeVisible()
          await page.keyboard.press('Escape')
          await expect(sidebar(page)).toBeHidden()
          await open.tap()
          await navLink(page, 'Files').tap()
          await pathnameIs(page, `/workspace/${id}/files`)
          await expect(sidebar(page)).toBeHidden()
          await open.tap()
          await page.getByRole('button', { name: 'Close navigation', exact: true }).tap()
          await expect(sidebar(page)).toBeHidden()
          const cookie = (await context.cookies()).find(
            (entry) => entry.name === 'sidebar_collapsed'
          )
          assert.notEqual(cookie?.value, '1', 'The drawer must not collapse the desktop rail')
        },
        { phone: true }
      )
    }
  )
  await check(
    'hover peek floats the rail, retracts on leave and yields to the palette',
    async () => {
      const { id } = await createWorkspace()
      await withPage(
        OWNER,
        async (page, context) => {
          // The attribute the desktop shell's pre-paint script sets; the rest is the web build.
          await context.addInitScript(() => {
            const mark = () => {
              if (!document.documentElement) return false
              document.documentElement.setAttribute('data-sim-desktop-title-bar', 'inset')
              return true
            }
            if (mark()) return
            const observer = new MutationObserver(() => {
              if (mark()) observer.disconnect()
            })
            observer.observe(document, { childList: true })
          })
          await visit(page, id)
          await expect(tree(page)).toHaveCount(0)
          const trigger = page.getByRole('button', { name: 'Expand sidebar', exact: true }).last()
          await trigger.hover()
          await expect(tree(page)).toBeVisible()
          await page.mouse.move(1200, 600, { steps: 8 })
          await expect(tree(page)).toHaveCount(0)
          await trigger.hover()
          await expect(tree(page)).toBeVisible()
          await page.keyboard.press('Escape')
          await expect(tree(page)).toHaveCount(0)
          await page.mouse.move(1200, 600, { steps: 2 })
          await trigger.hover()
          await expect(tree(page)).toBeVisible()
          await page.keyboard.press(`${MOD}+k`)
          await expect(palette(page)).toBeVisible()
          await expect(tree(page)).toHaveCount(0)
          await page.keyboard.press('Escape')
          await expect(palette(page)).toHaveCount(0)
          await trigger.click()
          await expect(tree(page)).toBeVisible()
          const cookie = (await context.cookies()).find(
            (entry) => entry.name === 'sidebar_collapsed'
          )
          assert.equal(cookie?.value, '0', 'Clicking the trigger docks the rail')
        },
        { collapsed: true }
      )
    }
  )
}

/** Canvas listeners attach after the page does, so a command is repeated until it lands. */
async function retryUntilBlockAdded(
  workflowId: string,
  blockTypePrefix: string,
  action: () => Promise<void>
) {
  await expect(async () => {
    await action()
    await expect
      .poll(
        async () =>
          (
            await db
              .select({ id: workflowBlocks.id })
              .from(workflowBlocks)
              .where(
                and(
                  eq(workflowBlocks.workflowId, workflowId),
                  like(workflowBlocks.type, `${blockTypePrefix}%`)
                )
              )
          ).length,
        { timeout: 10_000 }
      )
      .toBeGreaterThan(0)
  }).toPass({ timeout: 60_000 })
}

async function commandChecks() {
  section('Global commands')
  await check('goto-logs (Mod+L) opens Logs', async () => {
    const { id } = await createWorkspace()
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await page.keyboard.press(`${MOD}+l`)
      await pathnameIs(page, `/workspace/${id}/logs`)
    })
  })
  await check('open-search (Mod+K) toggles the palette', async () => {
    const { id } = await createWorkspace()
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await page.keyboard.press(`${MOD}+k`)
      await expect(palette(page)).toBeVisible()
      await expect
        .poll(() =>
          page.evaluate(() => {
            const active = document.activeElement
            return `${active?.tagName}[${active?.getAttribute('aria-label') ?? ''}] hasFocus=${document.hasFocus()}`
          })
        )
        .toBe('INPUT[Search anything] hasFocus=true')
      await page.keyboard.type('ab')
      await expect(paletteInput(page)).toHaveValue('ab')
      await page.keyboard.press(`${MOD}+k`)
      await expect(palette(page)).toHaveCount(0)
    })
  })
  await check('add-workflow (Mod+Shift+P) creates one for an editor', async () => {
    const { id } = await createWorkspace({ members: [[EDITOR, 'write']] })
    await withPage(EDITOR, async (page) => {
      await visit(page, id)
      await page.keyboard.press(`${MOD}+Shift+p`)
      await expect.poll(async () => (await workspaceWorkflows(id)).length).toBeGreaterThan(0)
    })
  })
  await check('add-workflow does nothing for a viewer', async () => {
    const { id } = await createWorkspace({ members: [[VIEWER, 'read']] })
    await withPage(VIEWER, async (page) => {
      await visit(page, id)
      await page.keyboard.press(`${MOD}+Shift+p`)
      await sleep(1_000)
      assert.equal((await workspaceWorkflows(id)).length, 0)
      await pathnameIs(page, `/workspace/${id}/tables`)
    })
  })
  await check('add-agent (Mod+Shift+A) drops an Agent block on the canvas', async () => {
    const { id } = await createWorkspace()
    const flow = await createWorkflow(id, OWNER)
    await withPage(OWNER, async (page) => {
      await visit(page, id, `w/${flow.id}`)
      await retryUntilBlockAdded(flow.id, 'agent', () => page.keyboard.press(`${MOD}+Shift+a`))
    })
  })
  await check(
    'toolbar search data: the palette block and tool rows work on the canvas',
    async () => {
      const { id } = await createWorkspace()
      const flow = await createWorkflow(id, OWNER)
      await withPage(OWNER, async (page) => {
        await visit(page, id, `w/${flow.id}`)
        await page.keyboard.press(`${MOD}+k`)
        await paletteInput(page).fill('Condition')
        await expect(paletteOption(page, /^Condition/).first()).toBeVisible()
        await page.keyboard.press('Escape')
        await retryUntilBlockAdded(flow.id, 'condition', async () => {
          await page.keyboard.press(`${MOD}+k`)
          await paletteInput(page).fill('Condition')
          await paletteOption(page, /^Condition/)
            .first()
            .click()
        })
        await retryUntilBlockAdded(flow.id, 'slack', async () => {
          await page.keyboard.press(`${MOD}+k`)
          await paletteInput(page).fill('Slack')
          await paletteOption(page, /^Slack/)
            .first()
            .click()
        })
      })
    }
  )
  notProvable(
    'connection block selector (the third consumer of initializeSearchData)',
    'Reached by dragging an edge off a block into empty canvas, which depends on React Flow internals rather than the sidebar. The shared store data it reads is proved by the palette check above, on the same page.'
  )
}

async function paletteChecks() {
  section('Mod+K palette')
  await check('actions run: Create workflow and Invite teammates', async () => {
    const { id } = await createWorkspace()
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await page.keyboard.press(`${MOD}+k`)
      await paletteOption(page, 'Create workflow').click()
      await expect.poll(async () => (await workspaceWorkflows(id)).length).toBe(1)
      await page.keyboard.press(`${MOD}+k`)
      await paletteOption(page, 'Invite teammates').click()
      await pathnameIs(page, `/workspace/${id}/settings/teammates`)
    })
  })
  await check('a viewer is not offered actions that write', async () => {
    const { id } = await createWorkspace({ members: [[VIEWER, 'read']] })
    await withPage(VIEWER, async (page) => {
      await visit(page, id)
      await page.keyboard.press(`${MOD}+k`)
      await expect(paletteOption(page, 'Invite teammates')).toBeVisible()
      await expect(paletteOption(page, 'Create workflow')).toHaveCount(0)
      await expect(paletteOption(page, 'Create folder')).toHaveCount(0)
    })
  })
  await check('Tab flips to ask mode, and Enter sends the text as a new chat', async () => {
    const { id } = await createWorkspace()
    const question = unique('What-changed')
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await page.keyboard.press(`${MOD}+k`)
      await paletteInput(page).fill(question)
      await page.keyboard.press('Tab')
      await expect(paletteOption(page, `New chat: ${question}`)).toBeVisible()
      const sent = page.waitForRequest(
        (request) => request.method() === 'POST' && request.url().endsWith('/api/mothership/chat')
      )
      await page.keyboard.press('Enter')
      assert((await sent).postData()?.includes(question), 'The chat carries the typed text')
      await pathnameIs(page, `/workspace/${id}/home`)
      await expect(page.getByText('Hello from the scripted agent.')).toBeVisible()
    })
  })
  await check('Tab twice returns to search with the text kept', async () => {
    const { id } = await createWorkspace()
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await page.keyboard.press(`${MOD}+k`)
      await paletteInput(page).fill('kept')
      await page.keyboard.press('Tab')
      await expect(paletteInput(page)).toHaveAttribute('placeholder', 'Ask Sim anything...')
      await page.keyboard.press('Tab')
      await expect(paletteInput(page)).toHaveAttribute('placeholder', 'Search anything...')
      await expect(paletteInput(page)).toHaveValue('kept')
    })
  })
  await check('blocks and tools only appear on the canvas', async () => {
    const { id } = await createWorkspace()
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await page.keyboard.press(`${MOD}+k`)
      await paletteInput(page).fill('Condition')
      await sleep(400)
      await expect(paletteOption(page, /^Condition/)).toHaveCount(0)
    })
  })
  await check('tables, knowledge bases and files open from the palette', async () => {
    const { id } = await createWorkspace()
    const tableId = generateId()
    const tableName = unique('Palette-table')
    await db.insert(userTableDefinitions).values({
      id: tableId,
      workspaceId: id,
      name: tableName,
      schema: { columns: [{ id: 'col_note', name: 'Note', type: 'string' }] },
      createdBy: OWNER.userId,
    })
    const kbId = generateId()
    const kbName = unique('Palette-kb')
    await db.insert(knowledgeBase).values({
      id: kbId,
      userId: OWNER.userId,
      workspaceId: id,
      name: kbName,
      updatedAt: new Date(),
    })
    const fileName = `${unique('palette-file')}.txt`
    await withPage(OWNER, async (page, context) => {
      const uploaded = await context.request.post(`${origin}/api/workspaces/${id}/files`, {
        headers: { Origin: origin },
        data: { name: fileName, content: 'hello', contentType: 'text/plain', encoding: 'utf-8' },
      })
      assert.equal(uploaded.status(), 201)
      const file = (await uploaded.json()) as { file: { id: string } }
      await visit(page, id, 'logs')
      const openFromPalette = async (query: string, path: string) => {
        await page.keyboard.press(`${MOD}+k`)
        await paletteInput(page).fill(query)
        await paletteOption(page, new RegExp(escapeRegExp(query)))
          .first()
          .click()
        await pathnameIs(page, path)
      }
      await openFromPalette(tableName, `/workspace/${id}/tables/${tableId}`)
      await openFromPalette(kbName, `/workspace/${id}/knowledge/${kbId}`)
      await openFromPalette(fileName, `/workspace/${id}/files/${file.file.id}`)
    })
  })
  await check('on the logs page the palette lists recent runs', async () => {
    const { id } = await createWorkspace()
    const flow = await createWorkflow(id, OWNER)
    const snapshotId = generateId()
    const executionId = generateId()
    await db.insert(workflowExecutionSnapshots).values({
      id: snapshotId,
      workflowId: flow.id,
      stateHash: snapshotId,
      stateData: { blocks: {}, edges: [], loops: {}, parallels: {}, variables: {} },
    })
    await db.insert(workflowExecutionLogs).values({
      id: generateId(),
      workflowId: flow.id,
      workspaceId: id,
      executionId,
      stateSnapshotId: snapshotId,
      level: 'info',
      status: 'completed',
      trigger: 'manual',
      startedAt: new Date(Date.now() - 1000),
      endedAt: new Date(),
      totalDurationMs: 1000,
      executionData: { finalOutput: {}, workflowInput: {}, traceSpans: [] },
    })
    await withPage(OWNER, async (page) => {
      await visit(page, id, 'logs')
      await page.keyboard.press(`${MOD}+k`)
      await expect(paletteOption(page, 'Refresh')).toBeVisible()
      await paletteOption(page, new RegExp(escapeRegExp(flow.name)))
        .first()
        .click()
      await expect.poll(() => page.url()).toContain(`executionId=${executionId}`)
    })
  })
  await check('integrations are listed, and opening one reaches its page', async () => {
    const { id } = await createWorkspace()
    await withPage(OWNER, async (page) => {
      await visit(page, id, 'logs')
      await page.keyboard.press(`${MOD}+k`)
      await paletteInput(page).fill('Firecrawl')
      await paletteOption(page, /Firecrawl/)
        .first()
        .click()
      await expect
        .poll(() => new URL(page.url()).pathname)
        .toContain(`/workspace/${id}/integrations`)
    })
  })
  await check('a hidden integrations tab empties the palette of integrations', async () => {
    const { id } = await createWorkspace({ members: [[REQUESTABLE, 'write']] })
    await withPage(REQUESTABLE, async (page) => {
      await visit(page, id, 'logs')
      await page.keyboard.press(`${MOD}+k`)
      await paletteInput(page).fill('Firecrawl')
      await sleep(400)
      await expect(paletteOption(page, /Firecrawl/)).toHaveCount(0)
    })
  })
  await check('arrows move the selection, Enter runs it, Escape closes', async () => {
    const { id } = await createWorkspace()
    const flow = await createWorkflow(id, OWNER)
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await page.keyboard.press(`${MOD}+k`)
      await paletteInput(page).fill(flow.name)
      const option = paletteOption(page, new RegExp(escapeRegExp(flow.name)))
      await expect(option.first()).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('Enter')
      await pathnameIs(page, `/workspace/${id}/w/${flow.id}`)
      await expect(palette(page)).toHaveCount(0)
      await page.keyboard.press(`${MOD}+k`)
      await paletteInput(page).fill('')
      const before = await palette(page).getByRole('option', { selected: true }).innerText()
      await page.keyboard.press('ArrowDown')
      await expect
        .poll(() => palette(page).getByRole('option', { selected: true }).innerText())
        .not.toBe(before)
      await page.keyboard.press('Escape')
      await expect(palette(page)).toHaveCount(0)
    })
  })
  await check('the scrim blocks the page and a click on it closes the palette', async () => {
    const { id } = await createWorkspace()
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await page.keyboard.press(`${MOD}+k`)
      await expect(palette(page)).toBeVisible()
      await expect(navLink(page, 'Logs').click({ trial: true, timeout: 1_500 })).rejects.toThrow()
      await page.mouse.click(1400, 880)
      await expect(palette(page)).toHaveCount(0)
      await pathnameIs(page, `/workspace/${id}/tables`)
    })
  })
  notProvable(
    'native browser-panel occlusion by the palette',
    'The palette hides the Electron browser view through the desktop bridge, which a web build does not have. `browser-page-dialogs.spec.ts` in `apps/desktop/e2e` covers the mechanism; the scrim and peek-yield checks here cover the web half.'
  )
}

async function realtimeChecks() {
  section('Realtime')
  await check('a workflow another session creates appears with no reload', async () => {
    const { id } = await createWorkspace({ members: [[EDITOR, 'write']] })
    const watcher = await openContext(OWNER)
    try {
      const page = await newPage(watcher)
      await visit(page, id)
      // Joining the room has no visible signal.
      await sleep(1_500)
      await withPage(EDITOR, async (other) => {
        await visit(other, id)
        await sidebar(other).getByRole('button', { name: 'New workflow' }).last().click()
        await expect.poll(async () => (await workspaceWorkflows(id)).length).toBe(1)
      })
      const [created] = await workspaceWorkflows(id)
      await expect(row(page, created.id)).toBeVisible()
    } finally {
      await watcher.close().catch(() => {})
    }
  })
  await check('a folder another session renames updates with no reload', async () => {
    const { id } = await createWorkspace({ members: [[EDITOR, 'write']] })
    const target = await createFolder(id, OWNER)
    const renamed = unique('Live-rename')
    const watcher = await openContext(OWNER)
    try {
      const page = await newPage(watcher)
      await visit(page, id)
      await expect(folderRow(page, target.name)).toBeVisible()
      // Joining the room has no visible signal.
      await sleep(1_500)
      await withPage(EDITOR, async (other) => {
        await visit(other, id)
        await openRowMenu(other, folderRow(other, target.name))
        await menuItem(other, 'Rename').click()
        const input = tree(other).getByRole('textbox')
        await input.fill(renamed)
        await input.press('Enter')
        await expect.poll(async () => (await folderDbRow(target.id)).name).toBe(renamed)
      })
      await expect(folderRow(page, renamed)).toBeVisible()
    } finally {
      await watcher.close().catch(() => {})
    }
  })
}

async function settingsChecks() {
  section('Settings entry')
  /** The key field is read-only until focused, which keeps password managers off it. */
  const dirtySecret = async (page: Page) => {
    const key = page.getByPlaceholder('API_KEY').first()
    await key.click()
    await key.fill('E2E_UNSAVED')
  }
  const accountChip = (page: Page, who: Persona) =>
    sidebar(page).getByRole('button', { name: who.name })
  await check('the account menu opens Settings and Back returns to where I was', async () => {
    const { id } = await createWorkspace()
    await withPage(OWNER, async (page) => {
      await visit(page, id, 'logs')
      await accountChip(page, OWNER).click()
      await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
      await pathnameIs(page, `/workspace/${id}/settings/general`)
      await sidebar(page).getByRole('button', { name: 'Back', exact: true }).click()
      await pathnameIs(page, `/workspace/${id}/logs`)
    })
  })
  await check('switching workspace from settings keeps the section', async () => {
    const a = await createWorkspace({ owner: EDITOR, name: unique('Settings-a') })
    const b = await createWorkspace({ owner: EDITOR, name: unique('Settings-b') })
    await withPage(EDITOR, async (page) => {
      await visit(page, a.id, 'settings/secrets')
      await switcher(page).click()
      await menuItem(page, new RegExp(escapeRegExp(b.name))).click()
      await pathnameIs(page, `/workspace/${b.id}/settings/secrets`)
    })
  })
  await check('dirty settings hold a workspace switch until discarded', async () => {
    const a = await createWorkspace({ owner: EDITOR, name: unique('Dirty-a') })
    const b = await createWorkspace({ owner: EDITOR, name: unique('Dirty-b') })
    await withPage(EDITOR, async (page) => {
      await visit(page, a.id, 'settings/secrets')
      const key = page.getByPlaceholder('API_KEY').first()
      await dirtySecret(page)
      await switcher(page).click()
      await menuItem(page, new RegExp(escapeRegExp(b.name))).click()
      const guard = dialog(page, 'Unsaved changes')
      await expect(guard).toBeVisible()
      await guard.getByRole('button', { name: 'Keep editing' }).click()
      await pathnameIs(page, `/workspace/${a.id}/settings/secrets`)
      await expect(key).toHaveValue('E2E_UNSAVED')
      await switcher(page).click()
      await menuItem(page, new RegExp(escapeRegExp(b.name))).click()
      await dialog(page, 'Unsaved changes').getByRole('button', { name: 'Discard changes' }).click()
      await pathnameIs(page, `/workspace/${b.id}/settings/secrets`)
    })
  })
  await check('dirty settings hold Back until discarded', async () => {
    const { id } = await createWorkspace()
    await withPage(OWNER, async (page) => {
      await visit(page, id, 'logs')
      await accountChip(page, OWNER).click()
      await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
      await pathnameIs(page, `/workspace/${id}/settings/general`)
      await sidebar(page).getByRole('link', { name: 'Secrets', exact: true }).click()
      await pathnameIs(page, `/workspace/${id}/settings/secrets`)
      await dirtySecret(page)
      await sidebar(page).getByRole('button', { name: 'Back', exact: true }).click()
      await dialog(page, 'Unsaved changes').getByRole('button', { name: 'Discard changes' }).click()
      await pathnameIs(page, `/workspace/${id}/logs`)
    })
  })
}

async function flagsPhaseChecks() {
  section('Flags on, Chat disabled')
  await check('flagged entries appear once their flags are on', async () => {
    const { id } = await createWorkspace()
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      for (const name of ['Dashboard', 'Tests', 'Changelog'])
        await expect(navLink(page, name)).toBeVisible()
    })
  })
  await check('flagged entries follow the same restriction as Files', async () => {
    const { id } = await createWorkspace({ members: [[REQUESTABLE, 'write']] })
    await withPage(REQUESTABLE, async (page) => {
      await visit(page, id, 'logs')
      for (const name of ['Dashboard', 'Tests', 'Changelog'])
        await expect(navLink(page, `${name}: access required`)).toBeVisible()
    })
  })
  await check('Chat disabled: New workflow replaces New chat and Chats is gone', async () => {
    const { id } = await createWorkspace()
    await createChat(id, OWNER)
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await expect(navLink(page, 'New chat')).toHaveCount(0)
      await expect(sidebar(page).getByRole('button', { name: 'Chats' })).toHaveCount(0)
      await expect(sidebar(page).getByRole('button', { name: 'New workflow' })).toHaveCount(2)
      await sidebar(page).getByRole('button', { name: 'New workflow' }).first().click()
      await expect.poll(async () => (await workspaceWorkflows(id)).length).toBe(1)
    })
  })
  await check('Chat disabled: a viewer has no top New workflow entry', async () => {
    const { id } = await createWorkspace({ members: [[VIEWER, 'read']] })
    await withPage(VIEWER, async (page) => {
      await visit(page, id)
      const buttons = sidebar(page).getByRole('button', { name: 'New workflow' })
      await expect(buttons).toHaveCount(1)
      await expect(buttons).toBeDisabled()
    })
  })
  await check('Chat disabled: the palette has no ask mode', async () => {
    const { id } = await createWorkspace()
    await withPage(OWNER, async (page) => {
      await visit(page, id)
      await page.keyboard.press(`${MOD}+k`)
      await expect(paletteOption(page, 'New chat')).toHaveCount(0)
      await paletteInput(page).fill('anything')
      await page.keyboard.press('Tab')
      await expect(paletteInput(page)).toHaveAttribute('placeholder', 'Search anything...')
    })
  })
}

async function main() {
  await seedOrganization()
  if (phase === 'flags') {
    await flagsPhaseChecks()
    return
  }
  await workflowTreeChecks()
  await dragAndDropChecks()
  await multiSelectChecks()
  await workspaceHeaderChecks()
  await chatChecks()
  await navGatingChecks()
  await chromeChecks()
  await commandChecks()
  await paletteChecks()
  await realtimeChecks()
  await settingsChecks()
}

async function healthCheck() {
  section('Health')
  await check('no unexplained browser runtime errors or same-origin 5xx responses', async () => {
    assert.deepEqual(unexpected, [])
  })
}

await main()
  .then(healthCheck)
  .catch((error) => {
    logger.error('Workspace sidebar E2E aborted', { error: getErrorMessage(error) })
    process.exitCode = 1
  })
  .finally(async () => {
    await browser.close().catch(() => {})
    const counts = writeReport()
    if (counts.failed > 0 || checks.length === 0) process.exitCode = 1
    logger.info(`Workspace sidebar E2E: ${JSON.stringify(counts)}`)
  })

process.exit(process.exitCode ?? 0)
