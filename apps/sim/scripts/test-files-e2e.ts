import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { type Browser, type BrowserContext, chromium, type Page } from '@playwright/test'
import { withUtcTimestamps } from '@sim/db/timestamps'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId, generateShortId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { makeSignature } from 'better-auth/crypto'
import postgres from 'postgres'
import {
  dropPaths,
  type FilesE2EContext,
  type FilesE2EFixture,
  type FilesE2ERequestOptions,
  runNavigationScaleChecks,
  runSearchWorkflowChecks,
  runSharingChecks,
  runUploadLifecycleChecks,
} from '@/scripts/files-e2e'

const logger = createLogger('FilesE2E')

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

const baseUrl = new URL(requiredEnvironment('FILES_E2E_BASE_URL'))
const databaseUrl = new URL(requiredEnvironment('FILES_E2E_DATABASE_URL'))
const authSecret = requiredEnvironment('FILES_E2E_AUTH_SECRET')
const reportPath = resolve(requiredEnvironment('FILES_E2E_REPORT_PATH'))
const reportDirectory = dirname(reportPath)
const supportedSuites = [
  'upload',
  'upload-lifecycle',
  'navigation',
  'navigation-scale',
  'search',
  'sharing',
]
const selectedSuites =
  process.env.FILES_E2E_SUITES?.split(',').map((name) => name.trim()) ?? supportedSuites
assert(
  selectedSuites.length > 0 && selectedSuites.every((name) => supportedSuites.includes(name)),
  `FILES_E2E_SUITES must list ${supportedSuites.join(', ')}`
)
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])
assert(loopbackHosts.has(baseUrl.hostname), 'The app must use a loopback host')
assert.equal(baseUrl.protocol, 'http:', 'The app must use local HTTP')
assert.equal(baseUrl.pathname, '/', 'The app URL must be an origin')
assert(!baseUrl.username && !baseUrl.password, 'The app URL must not include credentials')
assert(loopbackHosts.has(databaseUrl.hostname), 'The database must use a loopback host')
assert(['postgres:', 'postgresql:'].includes(databaseUrl.protocol), 'Expected PostgreSQL')
assert(
  /(?:^|[_-])test(?:[_-]|$)/i.test(databaseUrl.pathname.slice(1)),
  'Use a dedicated test database'
)
assert(authSecret.length >= 32, 'Use a local Better Auth secret with at least 32 characters')

const sql = postgres(
  databaseUrl.toString(),
  withUtcTimestamps({ max: 2, connection: { application_name: 'files-e2e' } })
)
const fixture: FilesE2EFixture = {
  ownerId: generateId(),
  orgId: generateId(),
  workspaceId: generateId(),
  cookie: '',
}
const startedAt = new Date().toISOString()
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const http: { method: string; path: string; status: number; durationMs: number }[] = []
const browserErrors: string[] = []
let browser: Browser | undefined
let context: BrowserContext | undefined
let scratch: string | undefined

function reportError(error: unknown): string {
  let message = getErrorMessage(error)
  for (const secret of [authSecret, fixture.cookie, process.env.FILES_E2E_CRON_SECRET]) {
    if (secret) message = message.replaceAll(secret, '[REDACTED]')
  }
  return message.replace(/(cookie|authorization|upload-token):[^\r\n]*/gi, '$1: [REDACTED]')
}

function record(value: unknown): Record<string, unknown> {
  assert(isRecordLike(value), 'Expected a JSON object')
  return value
}

function string(value: unknown): string {
  assert.equal(typeof value, 'string', 'Expected a string')
  return value as string
}

async function json(path: string, options: FilesE2ERequestOptions = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (options.authenticated !== false) {
    headers.set('Cookie', `better-auth.session_token=${fixture.cookie}`)
    headers.set('Origin', baseUrl.origin)
  }
  for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value)
  const start = performance.now()
  const response = await fetch(new URL(path, baseUrl), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: 'error',
    signal: AbortSignal.timeout(options.timeoutMs ?? 180_000),
  })
  http.push({
    method: options.method ?? 'GET',
    path,
    status: response.status,
    durationMs: Math.round(performance.now() - start),
  })
  const text = await response.text()
  const expected = options.expected ?? 200
  assert(
    (Array.isArray(expected) ? expected : [expected]).includes(response.status),
    `${options.method ?? 'GET'} ${path}: ${response.status}; ${text.slice(0, 500)}`
  )
  return text ? record(JSON.parse(text)) : {}
}

async function check(name: string, run: () => Promise<void>) {
  const start = performance.now()
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - start) })
    logger.info(`PASS ${name}`)
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - start),
      error: reportError(error),
    })
    throw error
  }
}

async function eventually<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  message: string,
  timeoutMs = 120_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  do {
    const value = await read()
    if (ready(value)) return value
    await sleep(200)
  } while (Date.now() < deadline)
  throw new Error(message)
}

async function seed() {
  const email = `files-e2e-${fixture.ownerId}@files-e2e.test`
  const token = generateShortId()
  await sql.begin(async (tx) => {
    await tx`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at)
      values (${fixture.ownerId}, 'Files E2E Owner', ${email}, ${email}, true, now(), now())`
    await tx`insert into user_stats (id, user_id) values (${generateId()}, ${fixture.ownerId})`
    await tx`insert into organization (id, name, slug, created_at)
      values (${fixture.orgId}, 'Files E2E', ${`files-e2e-${fixture.orgId}`}, now())`
    await tx`insert into member (id, user_id, organization_id, role)
      values (${generateId()}, ${fixture.ownerId}, ${fixture.orgId}, 'owner')`
    await tx`insert into workspace (id, name, owner_id, billed_account_user_id, organization_id)
      values (${fixture.workspaceId}, 'Files E2E Workspace', ${fixture.ownerId}, ${fixture.ownerId}, ${fixture.orgId})`
    await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type)
      values (${generateId()}, ${fixture.ownerId}, 'workspace', ${fixture.workspaceId}, 'admin')`
    await tx`insert into session (id, token, user_id, active_organization_id, expires_at, created_at, updated_at)
      values (${generateId()}, ${token}, ${fixture.ownerId}, ${fixture.orgId}, now() + interval '1 day', now(), now())`
  })
  fixture.cookie = encodeURIComponent(`${token}.${await makeSignature(token, authSecret)}`)
}

async function cleanup() {
  await sql.begin(async (tx) => {
    await tx`delete from permissions where entity_type = 'workspace' and entity_id = ${fixture.workspaceId}`
    await tx`delete from workspace where id = ${fixture.workspaceId}`
    await tx`delete from organization where id = ${fixture.orgId}`
    await tx`delete from "user" where id = ${fixture.ownerId}`
    await tx`delete from rate_limit_bucket where key = ${`route:file-folder-upload:${fixture.ownerId}`}`
  })
  await rm(resolve('uploads', 'workspace', fixture.workspaceId), { recursive: true, force: true })
  if (scratch) await rm(scratch, { recursive: true, force: true })
}

async function uploadDirectory(
  page: Page,
  path: string,
  expectedCount: number,
  timeoutMs = 120_000
) {
  await page.locator('input[webkitdirectory]').waitFor({ state: 'attached' })
  await page.waitForFunction(
    () => !document.querySelector<HTMLInputElement>('input[webkitdirectory]')?.disabled
  )
  await page.getByRole('button', { name: 'Upload', exact: true }).click()
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('menuitem', { name: 'Upload folder', exact: true }).click(),
  ])
  await chooser.setFiles(path)
  await eventually(
    () => sql`select id from workspace_files where workspace_id = ${fixture.workspaceId}`,
    (rows) => rows.length === expectedCount,
    `Expected ${expectedCount} uploaded files`,
    timeoutMs
  )
  await page.locator('input[webkitdirectory]').waitFor({ state: 'attached' })
  await page.waitForFunction(
    () => !document.querySelector<HTMLInputElement>('input[webkitdirectory]')?.disabled
  )
}

async function runUploadChecks(page: Page, sourceDirectory: string) {
  const listPath = `/workspace/${fixture.workspaceId}/files`
  const samples = new Map([
    ['env.example', Buffer.from('DEMO_MODE=true\n')],
    ['nested/env.template', Buffer.from('DEMO_ENDPOINT=http://localhost\n')],
    ['nested/未知.config', Buffer.from('UTF-8 round trip: 日本語\n')],
    ['nested/deeper/arbitrary.custombin', Buffer.from([0, 255, 13, 10, 128, 1, 0])],
    ['nested/deeper/empty', Buffer.alloc(0)],
  ])
  for (const [path, bytes] of samples) {
    await mkdir(dirname(join(sourceDirectory, path)), { recursive: true })
    await writeFile(join(sourceDirectory, path), bytes)
  }
  await page.goto(new URL(listPath, baseUrl).href, {
    waitUntil: 'domcontentloaded',
    timeout: 180_000,
  })
  await page.locator('input[webkitdirectory]').waitFor({ state: 'attached' })

  await check(
    'directory picker preserves nested configuration, Unicode, binary, and empty files',
    async () => {
      await uploadDirectory(page, sourceDirectory, samples.size, 180_000)
      const tree =
        await sql`select id, name, parent_id from folder where workspace_id = ${fixture.workspaceId}`
      const root = tree.find((row) => row.name === 'Project' && row.parent_id === null)
      assert(root, 'Uploaded root folder missing')
      const nested = tree.find((row) => row.name === 'nested' && row.parent_id === root.id)
      assert(nested, 'Nested directory missing')
      const deeper = tree.find((row) => row.name === 'deeper' && row.parent_id === nested.id)
      assert(deeper, 'Deep directory missing')
      const files =
        await sql`select original_name, folder_id, key from workspace_files where workspace_id = ${fixture.workspaceId}`
      for (const [path, expected] of samples) {
        const name = path.split('/').at(-1)
        const parent = path.startsWith('nested/deeper/')
          ? deeper.id
          : path.startsWith('nested/')
            ? nested.id
            : root.id
        const file = files.find((row) => row.original_name === name && row.folder_id === parent)
        assert(file, `Hierarchy missing for ${path}`)
        const response = await page.request.get(
          new URL(
            `/api/files/serve/${encodeURIComponent(string(file.key))}?context=workspace&download=true`,
            baseUrl
          ).href,
          { timeout: 180_000 }
        )
        assert.equal(response.status(), 200)
        assert.deepEqual(await response.body(), expected, `Downloaded bytes changed for ${path}`)
      }
    }
  )

  await check('repeated directory imports keep both roots without mixing their files', async () => {
    await writeFile(join(sourceDirectory, 'env.example'), 'DEMO_MODE=false\n')
    await uploadDirectory(page, sourceDirectory, samples.size * 2)
    const roots =
      await sql`select id, name from folder where workspace_id = ${fixture.workspaceId} and parent_id is null order by name`
    assert.deepEqual(
      roots.map((row) => row.name),
      ['Project', 'Project (1)']
    )
    for (const [index, root] of roots.entries()) {
      const [file] =
        await sql`select key from workspace_files where workspace_id = ${fixture.workspaceId}
        and folder_id = ${string(root.id)} and original_name = 'env.example'`
      assert(file)
      const response = await page.request.get(
        new URL(
          `/api/files/serve/${encodeURIComponent(string(file.key))}?context=workspace&download=true`,
          baseUrl
        ).href,
        { timeout: 180_000 }
      )
      assert.equal(await response.text(), index === 0 ? 'DEMO_MODE=true\n' : 'DEMO_MODE=false\n')
    }
  })

  await check('directory uploads accept a destination with a 128-character legacy ID', async () => {
    const destinationId = `${fixture.workspaceId}-`.padEnd(128, 'x')
    await sql`insert into folder (id, workspace_id, user_id, resource_type, name)
      values (${destinationId}, ${fixture.workspaceId}, ${fixture.ownerId}, 'file', 'Legacy destination')`
    const prepared = await json(
      `/api/workspaces/${fixture.workspaceId}/files/folders/prepare-upload`,
      {
        method: 'POST',
        body: { targetFolderId: destinationId, paths: [['Legacy upload']] },
      }
    )
    assert(Array.isArray(prepared.folders) && prepared.folders.length === 1)
    const uploadedId = string(record(prepared.folders[0]).id)
    const [stored] = await sql`select parent_id from folder where id = ${uploadedId}
      and workspace_id = ${fixture.workspaceId}`
    assert.equal(stored?.parent_id, destinationId)
  })

  await check(
    'folder preparation refuses unauthenticated, missing, unsafe, and oversized destinations',
    async () => {
      const path = `/api/workspaces/${fixture.workspaceId}/files/folders/prepare-upload`
      await json(path, {
        method: 'POST',
        authenticated: false,
        body: { targetFolderId: null, paths: [['Denied']] },
        expected: 401,
      })
      await json(path, {
        method: 'POST',
        body: { targetFolderId: generateId(), paths: [['Denied']] },
        expected: 404,
      })
      await json(path, {
        method: 'POST',
        body: { targetFolderId: null, paths: [['Denied'], ['Denied', '..']] },
        expected: 400,
      })
      await json(path, {
        method: 'POST',
        body: { targetFolderId: null, paths: [['Denied'], ['Denied', 'x'.repeat(256)]] },
        expected: 400,
      })
      assert.equal(
        (
          await sql`select id from folder where workspace_id = ${fixture.workspaceId} and name = 'Denied'`
        ).length,
        0
      )
    }
  )
}

async function runDropChecks(page: Page, sourceDirectory: string) {
  await check(
    'native directory drops drain multiple reader pages and preserve empty folders',
    async () => {
      const droppedRoot = join(sourceDirectory, 'Dropped directories')
      for (let index = 0; index < 105; index++) {
        await mkdir(join(droppedRoot, `Empty ${String(index).padStart(3, '0')}`), {
          recursive: true,
        })
      }
      await writeFile(join(droppedRoot, 'zz-last.txt'), 'Reader pagination completed\n')
      await dropPaths(page, [droppedRoot])
      const folders = await eventually(
        () =>
          sql`select id, parent_id, name from folder where workspace_id = ${fixture.workspaceId}`,
        (rows) => rows.filter((row) => string(row.name).startsWith('Empty ')).length === 105,
        'Dropped directory readers did not preserve all 105 empty children'
      )
      const root = folders.find((row) => row.name === 'Dropped directories')
      assert(root)
      assert(
        folders
          .filter((row) => string(row.name).startsWith('Empty '))
          .every((row) => row.parent_id === root.id)
      )
      await eventually(
        () =>
          sql`select id from workspace_files where workspace_id = ${fixture.workspaceId} and folder_id = ${string(root.id)} and original_name = 'zz-last.txt'`,
        (rows) => rows.length === 1,
        'The file after the first directory reader page was not uploaded'
      )
      await page.waitForFunction(
        () => !document.querySelector<HTMLInputElement>('input[webkitdirectory]')?.disabled
      )
    }
  )

  await check(
    'cancel stops queued batches and a full queue rejects additional drops visibly',
    async () => {
      const names = [
        'cancel-active.txt',
        'cancel-queued-a.txt',
        'cancel-queued-b.txt',
        'cancel-overflow.txt',
        'after-cancel.txt',
      ]
      const paths = names.map((name) => join(sourceDirectory, name))
      for (const path of paths) await writeFile(path, 'Bounded upload cancellation\n')
      let release: () => void = () => {}
      const gate = new Promise<void>((resolveGate) => {
        release = resolveGate
      })
      let intercepted = 0
      const routePattern = '**/api/files/uploads'
      await page.route(routePattern, async (route) => {
        intercepted += 1
        if (intercepted === 1) await gate
        await route.continue().catch(() => {})
      })
      try {
        await dropPaths(page, [paths[0]])
        await eventually(
          async () => intercepted,
          (count) => count === 1,
          'Active upload never reached the HTTP boundary'
        )
        await dropPaths(page, [paths[1]])
        await dropPaths(page, [paths[2]])
        await dropPaths(page, [paths[3]])
        await page.getByText('The upload queue is full', { exact: true }).waitFor()
        await page.getByRole('button', { name: /^\d+\/\d+/ }).click()
        await page.getByRole('menuitem', { name: 'Cancel upload', exact: true }).click()
        release()
        await page.waitForFunction(
          () => !document.querySelector<HTMLInputElement>('input[webkitdirectory]')?.disabled
        )
        await dropPaths(page, [paths[4]])
        await eventually(
          () =>
            sql`select original_name from workspace_files where workspace_id = ${fixture.workspaceId} and original_name = 'after-cancel.txt'`,
          (rows) => rows.length === 1,
          'A new upload did not recover after cancellation'
        )
        const persisted =
          await sql`select original_name from workspace_files where workspace_id = ${fixture.workspaceId} and original_name = any(${names})`
        assert.deepEqual(
          persisted.map((row) => row.original_name),
          ['after-cancel.txt']
        )
      } finally {
        release()
        await page.unroute(routePattern)
      }
    }
  )
}

async function createFolder(name: string, parentId: string | null) {
  const response = await json(`/api/workspaces/${fixture.workspaceId}/files/folders`, {
    method: 'POST',
    body: { name, parentId },
  })
  return string(record(response.folder).id)
}

async function runNavigationChecks(page: Page) {
  const a = await createFolder('Navigation A', null)
  const b = await createFolder('Navigation B', a)
  const c = await createFolder('Navigation C', b)
  const d = await createFolder('Navigation D', c)
  const sibling = await createFolder('Navigation sibling', a)
  const url = (folderId: string) =>
    new URL(`/workspace/${fixture.workspaceId}/files?folderId=${folderId}`, baseUrl).href
  await page.goto(url(b), { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await page.getByRole('combobox', { name: 'Navigate within Navigation A', exact: true }).waitFor()

  await check('the Files root picker searches and opens top-level folders', async () => {
    await page.goto(new URL(`/workspace/${fixture.workspaceId}/files`, baseUrl).href, {
      waitUntil: 'domcontentloaded',
    })
    await page.getByRole('combobox', { name: 'Navigate within Files', exact: true }).click()
    await page.getByPlaceholder('Find folder...').fill('Navigation A')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.waitForURL(url(a))
    await page.goto(url(b), { waitUntil: 'domcontentloaded' })
  })

  await check('short breadcrumb labels remain fully visible at desktop width', async () => {
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    const labels = [
      page
        .getByRole('button', { name: 'Files', exact: true })
        .first()
        .getByText('Files', { exact: true }),
      page.getByText('Navigation B', { exact: true }).first(),
    ]
    const geometry = []
    for (const label of labels) {
      geometry.push(
        await label.evaluate((element) => {
          const ancestors = []
          let node: Element | null = element
          for (let index = 0; node && index < 5; index++, node = node.parentElement) {
            const style = getComputedStyle(node)
            ancestors.push({
              tag: node.tagName,
              width: node.getBoundingClientRect().width,
              clientWidth: node.clientWidth,
              scrollWidth: node.scrollWidth,
              flex: style.flex,
              minWidth: style.minWidth,
              maxWidth: style.maxWidth,
            })
          }
          return { label: element.textContent, ancestors }
        })
      )
    }
    await writeFile(
      join(reportDirectory, 'breadcrumb-geometry.json'),
      `${JSON.stringify(geometry, null, 2)}\n`
    )
    await page.screenshot({ path: join(reportDirectory, 'breadcrumb-geometry.png') })
    for (const item of geometry) {
      const label = item.ancestors[0]
      assert(
        label && label.scrollWidth <= label.clientWidth + 1,
        `${item.label} is clipped despite available header space`
      )
    }
  })

  await check('breadcrumb hover leaves other header actions visually unchanged', async () => {
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    const upload = page.getByRole('button', { name: 'Upload', exact: true })
    await page.mouse.move(900, 400)
    const before = await upload.screenshot({ animations: 'disabled' })
    await page.getByRole('button', { name: 'Files', exact: true }).first().hover()
    await page.getByText('Path', { exact: true }).waitFor()
    const after = await upload.screenshot({ animations: 'disabled' })
    await writeFile(join(reportDirectory, 'header-before.png'), before)
    await writeFile(join(reportDirectory, 'header-hover.png'), after)
    assert.equal(
      createHash('sha256').update(after).digest('hex'),
      createHash('sha256').update(before).digest('hex'),
      'Hover changed unrelated header action pixels'
    )
    await page.mouse.move(900, 400)
    await page.getByText('Path', { exact: true }).waitFor({ state: 'hidden' })
  })

  await check(
    'folder navigation preserves header action DOM identities and positions',
    async () => {
      const names = ['Upload', 'New folder', 'New file']
      const rectangles = new Map<
        string,
        Awaited<ReturnType<ReturnType<Page['getByRole']>['boundingBox']>>
      >()
      for (const name of names) {
        const action = page.getByRole('button', { name, exact: true })
        await action.evaluate(
          (element, marker) => element.setAttribute('data-files-e2e-identity', marker),
          name
        )
        rectangles.set(name, await action.boundingBox())
      }
      await page.getByRole('button', { name: 'Navigation A', exact: true }).click()
      await page.waitForURL(url(a))
      for (const name of names) {
        const action = page.getByRole('button', { name, exact: true })
        assert.equal(
          await action.getAttribute('data-files-e2e-identity'),
          name,
          `Navigation remounted ${name}`
        )
        assert.deepEqual(
          await action.boundingBox(),
          rectangles.get(name),
          `Navigation moved ${name}`
        )
      }
    }
  )

  await check(
    'each breadcrumb opens a searchable child picker with keyboard navigation',
    async () => {
      await page
        .getByRole('combobox', { name: 'Navigate within Navigation A', exact: true })
        .click()
      await page.getByPlaceholder('Find folder...').fill('sibling')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      await page.waitForURL(url(sibling))
      await page.goBack()
      await page.waitForURL(url(a))
      await page.goForward()
      await page.waitForURL(url(sibling))
    }
  )

  await check('dragging from a deep folder exposes hidden ancestor drop targets', async () => {
    const movedFolder = await createFolder('Move to ancestor', d)
    await page.setViewportSize({ width: 900, height: 800 })
    await page.goto(url(d), { waitUntil: 'domcontentloaded' })
    const source = page.locator(`[data-row-id="folder:${movedFolder}"]`)
    await source.waitFor()
    const drag = await page.evaluateHandle(() => new DataTransfer())
    try {
      await source.dispatchEvent('dragstart', { dataTransfer: drag })
      const target = page.getByRole('button', { name: 'Navigation B', exact: true })
      await target.waitFor({ state: 'visible', timeout: 5000 })
      const geometry = await target.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        const hit = document.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2
        )
        return {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          reachable: hit === element || (hit !== null && element.contains(hit)),
        }
      })
      await writeFile(
        join(reportDirectory, 'ancestor-drop-geometry.json'),
        `${JSON.stringify(geometry, null, 2)}\n`
      )
      assert(
        geometry.width > 0 && geometry.height > 0 && geometry.reachable,
        'The expanded ancestor must remain a reachable drop target at a constrained viewport'
      )
      await target.dispatchEvent('dragover', { dataTransfer: drag })
      await target.dispatchEvent('drop', { dataTransfer: drag })
      await eventually(
        () => sql`select parent_id from folder where id = ${movedFolder}`,
        (rows) => rows[0]?.parent_id === b,
        'A drop onto a collapsed ancestor did not persist the move'
      )
    } finally {
      await page.evaluate(() => window.dispatchEvent(new DragEvent('dragend')))
      await drag.dispose()
      await page.setViewportSize({ width: 1440, height: 1000 })
    }
  })

  await check('deep folder trails collapse ancestors into a navigable overflow menu', async () => {
    await page.goto(url(d), { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '…', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Navigation B', exact: true }).click()
    await page.waitForURL(url(b))
    await page.setViewportSize({ width: 900, height: 800 })
    await page.getByRole('combobox', { name: 'Navigate within Navigation B', exact: true }).click()
    await page.keyboard.press('Escape')
    await page.screenshot({ path: join(reportDirectory, 'folder-navigation.png') })
    await page.setViewportSize({ width: 1440, height: 1000 })
  })
}

async function run() {
  await mkdir(reportDirectory, { recursive: true })
  scratch = await mkdtemp(join(tmpdir(), 'sim-files-e2e-'))
  await seed()
  browser = await chromium.launch({ headless: true })
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addCookies([
    { name: 'better-auth.session_token', value: fixture.cookie, url: baseUrl.origin },
  ])
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false })
  const page = await context.newPage()
  page.setDefaultTimeout(60_000)
  page.setDefaultNavigationTimeout(180_000)
  page.on('pageerror', (error) => browserErrors.push(reportError(error)))
  if (selectedSuites.includes('upload')) {
    await runUploadChecks(page, join(scratch, 'Project'))
    await runDropChecks(page, scratch)
  }
  if (selectedSuites.includes('navigation')) await runNavigationChecks(page)
  const suite: FilesE2EContext = {
    fixture,
    sql,
    page,
    baseUrl,
    reportDirectory,
    check,
    json,
    cronSecret: process.env.FILES_E2E_CRON_SECRET,
  }
  if (selectedSuites.includes('upload-lifecycle')) await runUploadLifecycleChecks(suite, scratch)
  if (selectedSuites.includes('navigation-scale')) await runNavigationScaleChecks(suite)
  if (selectedSuites.includes('search')) await runSearchWorkflowChecks(suite)
  if (selectedSuites.includes('sharing')) await runSharingChecks(suite)
  await check('browser execution completes without uncaught runtime errors', async () => {
    assert.deepEqual(browserErrors, [])
  })
}

try {
  await run()
} catch (error) {
  logger.error('Files E2E failed', { error: reportError(error) })
  process.exitCode = 1
} finally {
  if (context)
    await context.tracing
      .stop({ path: join(reportDirectory, 'files-browser-trace.zip') })
      .catch(() => {})
  await browser?.close()
  try {
    await cleanup()
  } catch (error) {
    logger.error('Files E2E cleanup failed', { error: reportError(error) })
    process.exitCode = 1
  }
  await sql.end()
  await mkdir(reportDirectory, { recursive: true })
  await writeFile(
    reportPath,
    `${JSON.stringify({ startedAt, completedAt: new Date().toISOString(), status: process.exitCode ? 'failed' : 'passed', selectedSuites, transport: 'Real Chromium, HTTP, PostgreSQL, and local file storage', checks, http, browserErrors }, null, 2)}\n`
  )
  logger.info(
    `Files E2E ${process.exitCode ? 'failed' : 'passed'}: ${checks.filter((entry) => entry.status === 'passed').length}/${checks.length} checks`
  )
}
