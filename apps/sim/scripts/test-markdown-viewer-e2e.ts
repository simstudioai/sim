import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { chromium, expect, type Locator, type Page, webkit } from '@playwright/test'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId, generateShortId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import { makeSignature } from 'better-auth/crypto'
import postgres from 'postgres'

/**
 * Browser layout and persistence proof against a disposable local app and database.
 * Set MARKDOWN_VIEWER_E2E_BASE_URL, MARKDOWN_VIEWER_E2E_DATABASE_URL,
 * MARKDOWN_VIEWER_E2E_AUTH_SECRET, and MARKDOWN_VIEWER_E2E_REPORT_PATH.
 * Run from apps/sim with a matching realtime server and installed Playwright browsers.
 * MARKDOWN_VIEWER_E2E_BROWSER and MARKDOWN_VIEWER_E2E_WIDTH narrow diagnostic runs.
 * The fixture exercises syntax described by https://spec.commonmark.org/0.31.2/
 * and https://github.github.com/gfm/, plus Sim's Mermaid and raw-source nodes.
 */
const logger = createLogger('MarkdownViewerE2E')
function required(name: string): string {
  const value = process.env[name]
  assert(value, `${name} is required`)
  return value
}
const base = new URL(required('MARKDOWN_VIEWER_E2E_BASE_URL'))
const database = new URL(required('MARKDOWN_VIEWER_E2E_DATABASE_URL'))
for (const url of [base, database]) {
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Requires loopback')
}
assert.equal(base.protocol, 'http:')
assert(['postgres:', 'postgresql:'].includes(database.protocol))
assert(/(?:^|[_-])test(?:[_-]|$)/i.test(database.pathname.slice(1)), 'Requires a test database')
const secret = required('MARKDOWN_VIEWER_E2E_AUTH_SECRET')
const reportPath = resolve(required('MARKDOWN_VIEWER_E2E_REPORT_PATH'))
const artifactDir = `${reportPath}.artifacts`
const sql = postgres(database.toString(), { max: 2 })
const userId = generateId()
const workspaceId = generateId()
const shareId = generateId()
const shareToken = generateShortId()
const token = generateShortId()
const cookie = `${token}.${await makeSignature(token, secret)}`
const cookieHeader = `better-auth.session_token=${cookie}`
const checks: { name: string; passed: boolean; durationMs: number; error?: string }[] = []
const errors: string[] = []
let fileId: string | undefined
const selectedBrowser = process.env.MARKDOWN_VIEWER_E2E_BROWSER
assert(!selectedBrowser || ['chromium', 'webkit'].includes(selectedBrowser), 'Unknown browser')
const selectedWidth = process.env.MARKDOWN_VIEWER_E2E_WIDTH
const widths = selectedWidth ? [Number(selectedWidth)] : [1440, 768, 390, 320]
assert(
  widths.every((width) => Number.isInteger(width) && width >= 320),
  'Invalid viewport width'
)

const columns = [
  'Option',
  'Run used',
  'Overall',
  'Without speed',
  'Correct',
  'Complete',
  'Sources',
  'Citations',
  'Freshness',
  'Calls per query',
  'Median time',
  'Under thirty seconds',
  'Estimated cost',
]
const wideTable = [
  `| ${columns.join(' | ')} |`,
  `| ${columns.map(() => '---').join(' | ')} |`,
  '| Option Alpha | Median of three runs per question | 91.5 | 97.9 | 2.86 | 2.94 | 3.00 | 3.00 | 2.94 | 2.6 | 26.4 s | Eight of twelve | $0.205 |',
  '| Option Beta | Single run | 91.4 | 98.7 | 2.83 | 2.91 | 2.99 | 2.95 | 2.90 | 3.5 | 33 s | Six of twelve | $0.242 |',
].join('\n')
const source = [
  '---\ntitle: Markdown layout proof\n---',
  '# Markdown layout proof',
  'A paragraph with **bold**, *emphasis*, ~~strikethrough~~, ==highlight==, `inline code`, and [a link](https://example.test).',
  '## Wide table',
  wideTable,
  '## Aligned and empty cells',
  '| Left | Center | Right |\n| :--- | :---: | ---: |\n| Escaped \\| pipe | **Strong** | 123.45 |\n| | `a \\| b` | |',
  '## Long values',
  `| Reference | Description |\n| --- | --- |\n| https://example.test/${'long-reference-'.repeat(35)} | ${'A paragraph that should wrap naturally. '.repeat(12)} |`,
  `A long prose link: https://example.test/${'long-path-'.repeat(40)}`,
  `Inline code: \`${'unbroken_value_'.repeat(30)}\`.`,
  '## Lists and quotations',
  '- First item\n  - Nested **item**\n- Second item',
  '3. Number three\n4. Number four',
  '- [x] Completed task\n- [ ] Open task\n  - [ ] Nested task',
  '> A quotation\n>\n> > A nested quotation',
  '## Code',
  `\`\`\`typescript\nconst longValue = "${'long_value_'.repeat(35)}";\n\nconst next = 2;\n\`\`\``,
  '~~~unrecognized-language\n<literal> & **not emphasis**\n~~~',
  '    indented code',
  '## Diagram',
  '```mermaid\nflowchart LR\n  A[Start] --> B[Validate] --> C[Finish]\n```',
  '## Images',
  '![Local image](/favicon/android-chrome-512x512.png)',
  '## Preserved source',
  '<details><summary>Raw HTML</summary>Retain this source</details>',
  'Footnote reference[^proof].\n\n[^proof]: Retain the definition.',
  '## Unicode',
  '日本語の文章。 العربية עברית café 👩🏽‍💻 — punctuation &amp; entities.',
  'A hard break  \ncontinues here.\n\n---\n\nThe final paragraph.',
].join('\n\n')

async function request(
  path: string,
  body?: Record<string, unknown>,
  method = body ? 'POST' : 'GET'
) {
  // boundary-raw-fetch: standalone browser proof calls an explicitly supplied loopback app with its own session.
  const response = await fetch(new URL(path, base), {
    method,
    headers: { Cookie: cookieHeader, Origin: base.origin, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  })
  assert(response.ok, `${path}: HTTP ${response.status}: ${await response.clone().text()}`)
  return response
}

async function readSource() {
  return (await request(`/api/files/public/${shareToken}/content`)).text()
}

async function check(name: string, run: () => Promise<void>, page?: Page) {
  const start = performance.now()
  try {
    await run()
    checks.push({ name, passed: true, durationMs: performance.now() - start })
    logger.info('Check passed', { name })
  } catch (error) {
    if (page) await page.screenshot({ path: resolve(artifactDir, `failure-${checks.length}.png`) })
    checks.push({
      name,
      passed: false,
      durationMs: performance.now() - start,
      error: getErrorMessage(error),
    })
    logger.error('Check failed', { name, error: getErrorMessage(error) })
  }
}

async function wideTableProof(page: Page) {
  const table = page.locator('.rich-markdown-prose table').filter({ hasText: 'Option Alpha' })
  await expect(table).toBeVisible({ timeout: 120_000 })
  const geometry = await table.evaluate((element) => {
    const wrapper = element.parentElement
    if (!wrapper) throw new Error('Table has no parent')
    return {
      columns: Array.from(
        element.querySelectorAll('th'),
        (cell) => cell.getBoundingClientRect().width
      ),
      client: wrapper.clientWidth,
      scroll: wrapper.scrollWidth,
    }
  })
  assert(
    geometry.columns.every((width) => width >= 79),
    `Unreadable columns: ${JSON.stringify(geometry)}`
  )
  assert(geometry.scroll > geometry.client + 100, 'The wide table must scroll independently')
  await table.locator('th').first().hover()
  await page.mouse.wheel(240, 0)
  await expect
    .poll(() => table.evaluate((element) => element.parentElement?.scrollLeft ?? 0))
    .toBeGreaterThan(0)
  await table.evaluate((element) => {
    const wrapper = element.parentElement
    if (wrapper) wrapper.scrollLeft = wrapper.scrollWidth
  })
  const last = table.locator('tr').nth(1).locator('td').last()
  const reachable = await last.evaluate((cell) => {
    const wrapper = cell.closest('table')?.parentElement
    if (!wrapper) return false
    const bounds = wrapper.getBoundingClientRect()
    const rect = cell.getBoundingClientRect()
    return (
      rect.right <= bounds.right + 2 && (rect.left >= bounds.left - 2 || rect.width > bounds.width)
    )
  })
  assert(reachable, 'The end of the final column must be reachable')
}

async function contained(page: Page) {
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    'Document overflow'
  )
  const editor = page.locator('.rich-markdown-prose').filter({ visible: true })
  const layout = await editor.evaluate((element) => ({
    width: element.clientWidth,
    scroll: element.scrollWidth,
  }))
  assert(
    layout.scroll <= layout.width + 2,
    `Prose expanded with its table: ${JSON.stringify(layout)}`
  )
}

async function proveCode(page: Page) {
  const code = page.locator('pre').filter({ hasText: 'const longValue' })
  await code.scrollIntoViewIfNeeded()
  assert(
    await code.evaluate((element) => element.scrollWidth > element.clientWidth + 100),
    'Long code must scroll'
  )
  await code.evaluate((element) => {
    element.scrollLeft = element.scrollWidth
  })
  assert(await code.evaluate((element) => element.scrollLeft > 0), 'Code cannot scroll')
}

async function proveFeatures(page: Page) {
  const longCell = page
    .locator('.rich-markdown-prose table')
    .filter({ hasText: 'long-reference-' })
    .locator('td')
    .first()
  assert(
    await longCell.evaluate((element) => element.getBoundingClientRect().width <= 321),
    'A long token expands its column without a bound'
  )
  const aligned = page.locator('.rich-markdown-prose table').filter({ hasText: 'Escaped | pipe' })
  const alignment = await aligned
    .locator('tr')
    .nth(1)
    .locator('td')
    .evaluateAll((cells) => cells.map((cell) => getComputedStyle(cell).textAlign))
  assert.deepEqual(alignment, ['left', 'center', 'right'])
  const image = page.getByAltText('Local image', { exact: true })
  await image.scrollIntoViewIfNeeded()
  await expect
    .poll(() =>
      image.evaluate((element) => element instanceof HTMLImageElement && element.naturalWidth > 0)
    )
    .toBe(true)
  assert(
    await image.evaluate(
      (element) =>
        element.getBoundingClientRect().width <=
        (element.closest('.rich-markdown-prose')?.clientWidth ?? 0)
    ),
    'Image exceeds the reading column'
  )
  await expect(page.locator('.mermaid-diagram-frame svg')).toBeAttached({ timeout: 30_000 })
  await contained(page)
}

async function proveToolbar(page: Page, toolbar: Locator) {
  await expect(toolbar).toBeVisible()
  const viewportWidth = await page.evaluate(() => innerWidth)
  await expect
    .poll(async () => {
      const bounds = await toolbar.evaluate((element) => {
        const popup = element.parentElement
        const container = popup?.parentElement
        if (!popup || !container) return null
        const bounds = popup.getBoundingClientRect()
        return {
          name: element.getAttribute('aria-label'),
          x: bounds.x,
          right: bounds.right,
          client: container.clientWidth,
          scroll: container.scrollWidth,
        }
      })
      return bounds &&
        bounds.x >= 0 &&
        bounds.right <= viewportWidth + 1 &&
        bounds.scroll <= bounds.client + 1
        ? 'contained'
        : JSON.stringify(bounds)
    })
    .toBe('contained')
  await toolbar.evaluate((element) => {
    const popup = element.parentElement
    if (popup) popup.scrollLeft = popup.scrollWidth
  })
  const lastAction = toolbar.getByRole('button').last()
  assert(
    await lastAction.evaluate((element) => {
      const popup = element.closest('[role="toolbar"]')?.parentElement
      if (!popup) return false
      const bounds = popup.getBoundingClientRect()
      const action = element.getBoundingClientRect()
      return action.left >= bounds.left && action.right <= bounds.right
    }),
    'The final toolbar action is unreachable'
  )
}

async function editLastCell(page: Page, marker: string) {
  await wideTableProof(page)
  const last = page
    .locator('.rich-markdown-prose table')
    .filter({ hasText: 'Option Alpha' })
    .locator('tr')
    .nth(1)
    .locator('td')
    .last()
  await last.click()
  await proveToolbar(page, page.getByRole('toolbar', { name: 'Table editing' }))
  await page.keyboard.press('End')
  await page.keyboard.insertText(marker)
  await expect.poll(readSource, { timeout: 30_000 }).toContain(marker)
  const saved = await readSource()
  for (const preserved of [
    'title: Markdown layout proof',
    '<details><summary>Raw HTML</summary>Retain this source</details>',
    '[^proof]',
    'const longValue',
    '```mermaid',
    '日本語の文章。',
    'Option Beta',
  ]) {
    assert(saved.includes(preserved), `Saving lost ${preserved}`)
  }
  await page.reload()
  await expect(page.locator('.rich-markdown-prose').filter({ visible: true })).toContainText(
    marker,
    { timeout: 120_000 }
  )
  await contained(page)
  await expect(page.locator('.rich-markdown-prose[contenteditable="true"]')).toBeVisible({
    timeout: 120_000,
  })
  await page
    .locator('.rich-markdown-prose strong')
    .filter({ hasText: /^bold$/ })
    .click()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Shift+ArrowRight')
  assert(
    await page.evaluate(() => Boolean(getSelection()?.toString().trim())),
    'Keyboard selection did not select text'
  )
  await proveToolbar(page, page.getByRole('toolbar', { name: 'Text formatting' }))
  await page.keyboard.press('ArrowRight')
}

async function proveCollaborationCursor(page: Page) {
  const peer = await page.context().newPage()
  peer.on('pageerror', (error) => errors.push(error.message))
  try {
    await peer.goto(page.url(), { timeout: 360_000 })
    await expect(peer.locator('.rich-markdown-prose[contenteditable="true"]')).toBeVisible({
      timeout: 120_000,
    })
    const peerTable = peer.locator('.rich-markdown-prose table').filter({ hasText: 'Option Alpha' })
    await peerTable.locator('th').first().click()
    await peer.keyboard.press('Home')
    const table = page.locator('.rich-markdown-prose table').filter({ hasText: 'Option Alpha' })
    await table.evaluate((element) => {
      if (element.parentElement) element.parentElement.scrollLeft = 0
    })
    await table.scrollIntoViewIfNeeded()
    const label = table
      .locator('.collaboration-carets__caret--active .collaboration-carets__label')
      .first()
    await expect(label).toBeVisible({ timeout: 20_000 })
    assert(
      await label.evaluate((element) => {
        const wrapper = element.closest('.tableWrapper')
        if (!wrapper) return false
        const label = element.getBoundingClientRect()
        const viewport = wrapper.getBoundingClientRect()
        return label.top >= viewport.top && label.bottom <= viewport.bottom
      }),
      'The table scroll container clips the collaborator name'
    )
    await page.screenshot({ path: resolve(artifactDir, `collaborator-${checks.length}.png`) })
  } finally {
    await peer.close()
  }
}

async function proveToolbarTracking(page: Page) {
  const viewport = page.viewportSize()
  assert(viewport)
  await page.setViewportSize({ width: 1440, height: 1000 })
  try {
    const table = page.locator('.rich-markdown-prose table').filter({ hasText: 'Option Alpha' })
    await table.evaluate((element) => {
      if (element.parentElement) element.parentElement.scrollLeft = 128
    })
    await table.locator('th').nth(6).click()
    const toolbar = page.getByRole('toolbar', { name: 'Table editing' })
    await proveToolbar(page, toolbar)
    const popup = toolbar.locator('..')
    const header = await popup.boundingBox()
    assert(header)
    await table.locator('tr').nth(1).locator('td').nth(6).click()
    await proveToolbar(page, toolbar)
    await expect
      .poll(async () => (await popup.boundingBox())?.width ?? 0)
      .toBeGreaterThan(header.width + 20)
    await expect
      .poll(async () => {
        const caret = await page.evaluate(() => {
          const selection = getSelection()
          if (!selection?.rangeCount) return null
          const rect = selection.getRangeAt(0).getBoundingClientRect()
          return (rect.left + rect.right) / 2
        })
        const bounds = await popup.boundingBox()
        return caret === null || !bounds
          ? Number.POSITIVE_INFINITY
          : Math.abs(bounds.x + bounds.width / 2 - caret)
      })
      .toBeLessThan(4)
    const before = await popup.boundingBox()
    assert(before)
    const movement = await table.evaluate((element) => {
      const wrapper = element.parentElement
      if (!wrapper) throw new Error('Missing table viewport')
      const from = wrapper.scrollLeft
      wrapper.scrollLeft += 64
      return { from, delta: wrapper.scrollLeft - from }
    })
    assert(movement.delta > 32, 'The table did not move with its toolbar open')
    await expect
      .poll(async () =>
        Math.abs(
          ((await popup.boundingBox())?.x ?? Number.POSITIVE_INFINITY) - before.x + movement.delta
        )
      )
      .toBeLessThan(2)
    await table.evaluate((element, left) => {
      if (element.parentElement) element.parentElement.scrollLeft = left
    }, movement.from)
    await expect
      .poll(async () =>
        Math.abs(((await popup.boundingBox())?.x ?? Number.POSITIVE_INFINITY) - before.x)
      )
      .toBeLessThan(2)
    await page.screenshot({ path: resolve(artifactDir, `toolbar-tracking-${checks.length}.png`) })
    await page
      .locator('.rich-markdown-prose strong')
      .filter({ hasText: /^bold$/ })
      .click()
  } finally {
    await page.setViewportSize(viewport)
  }
}

async function proveCollaborationScroll(page: Page) {
  const peer = await page.context().newPage()
  peer.on('pageerror', (error) => errors.push(error.message))
  try {
    await peer.goto(page.url(), { timeout: 360_000 })
    await expect(peer.locator('.rich-markdown-prose[contenteditable="true"]')).toBeVisible({
      timeout: 120_000,
    })
    const peerTable = peer.locator('.rich-markdown-prose table').filter({ hasText: 'Option Alpha' })
    await peerTable.locator('th').nth(6).click()
    await peer.keyboard.press('Home')
    const table = page.locator('.rich-markdown-prose table').filter({ hasText: 'Option Alpha' })
    const label = table.locator('.collaboration-carets__label').first()
    await expect(label).toBeAttached({ timeout: 20_000 })
    await table.scrollIntoViewIfNeeded()
    for (const edge of ['right', 'left', 'center'] as const) {
      await label.evaluate((element, edge) => {
        const caret = element.parentElement
        const wrapper = element.closest('.tableWrapper')
        if (!caret || !(wrapper instanceof HTMLElement)) throw new Error('Missing caret viewport')
        const viewport = wrapper.getBoundingClientRect()
        const target =
          edge === 'right'
            ? viewport.right - 20
            : edge === 'left'
              ? viewport.left + 20
              : (viewport.left + viewport.right) / 2
        wrapper.scrollLeft += caret.getBoundingClientRect().left - target
      }, edge)
      await expect
        .poll(() =>
          label.evaluate((element) => {
            const wrapper = element.closest('.tableWrapper')
            if (!wrapper) return false
            const bounds = wrapper.getBoundingClientRect()
            const label = element.getBoundingClientRect()
            return (
              label.width > 0 &&
              label.left >= bounds.left - 1 &&
              label.right <= bounds.right + 1 &&
              label.top >= bounds.top &&
              label.bottom <= bounds.bottom
            )
          })
        )
        .toBe(true)
    }
    await page.mouse.move(1, 1)
    await expect
      .poll(() => label.evaluate((element) => Number(getComputedStyle(element).opacity)))
      .toBe(0)
    await table.evaluate((element) => {
      if (element.parentElement) element.parentElement.scrollLeft += 16
    })
    const idleOpacity = await label.evaluate(async (element) => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
      return Number(getComputedStyle(element).opacity)
    })
    assert.equal(idleOpacity, 0, 'Local scrolling reactivated an idle collaborator name')
    await page.screenshot({
      path: resolve(artifactDir, `collaborator-scroll-${checks.length}.png`),
    })
  } finally {
    await peer.close()
  }
}

try {
  await mkdir(artifactDir, { recursive: true })
  await writeFile(resolve(artifactDir, 'fixture.md'), source)
  await sql.begin(async (tx) => {
    const email = `${userId}@markdown-e2e.test`
    await tx`insert into "user" (id, name, email, normalized_email, email_verified, created_at, updated_at) values (${userId}, 'Markdown collaboration proof name', ${email}, ${email}, true, now(), now())`
    await tx`insert into user_stats (id, user_id) values (${generateId()}, ${userId})`
    await tx`insert into project (id, name, owner_id) values (${workspaceId}, 'Markdown E2E', ${userId})`
    await tx`insert into workspace (id, project_id, name, owner_id, billed_account_user_id) values (${workspaceId}, ${workspaceId}, 'Markdown E2E', ${userId}, ${userId})`
    await tx`insert into permissions (id, user_id, entity_type, entity_id, permission_type) values (${generateId()}, ${userId}, 'workspace', ${workspaceId}, 'admin')`
    await tx`insert into session (id, token, user_id, expires_at, created_at, updated_at) values (${generateId()}, ${token}, ${userId}, now() + interval '1 day', now(), now())`
  })
  const created = toRecord(
    toRecord(
      await (
        await request(`/api/workspaces/${workspaceId}/files`, {
          name: 'markdown-layout.md',
          content: source,
          contentType: 'text/markdown',
        })
      ).json()
    ).file
  )
  assert.equal(typeof created.id, 'string')
  fileId = String(created.id)
  await sql`insert into public_share (id, resource_type, resource_id, entity_type, entity_id, workspace_id, created_by, token) values (${shareId}, 'file', ${fileId}, 'workspace', ${workspaceId}, ${workspaceId}, ${userId}, ${shareToken})`
  for (const [browserName, browserType] of [
    ['chromium', chromium],
    ['webkit', webkit],
  ] as const) {
    if (selectedBrowser && browserName !== selectedBrowser) continue
    const initialSource = await readSource()
    const browser = await browserType.launch({ headless: true })
    try {
      const context = await browser.newContext()
      await context.addCookies([
        { name: 'better-auth.session_token', value: cookie, url: base.origin },
      ])
      const page = await context.newPage()
      page.on('pageerror', (error) => errors.push(`${browserName}: ${error.message}`))
      for (const width of widths) {
        await page.setViewportSize({ width, height: 1000 })
        await page.goto(new URL(`/f/${shareToken}`, base).href, { timeout: 360_000 })
        await check(`${browserName} public ${width}: readable and reachable wide columns`, () =>
          wideTableProof(page)
        )
        await check(`${browserName} public ${width}: prose and long content stay contained`, () =>
          contained(page)
        )
        await check(`${browserName} public ${width}: long code scrolls`, () => proveCode(page))
        await check(`${browserName} public ${width}: alignment, images, and diagrams`, () =>
          proveFeatures(page)
        )
        await page.locator('.rich-markdown-prose h1').scrollIntoViewIfNeeded()
        await page.screenshot({ path: resolve(artifactDir, `${browserName}-public-${width}.png`) })
      }
      await check(`${browserName}: viewing preserves source bytes`, async () => {
        const saved = await readSource()
        assert.equal(saved, initialSource)
      })
      for (const theme of ['light', 'dark'] as const) {
        await sql`insert into settings (id, user_id, theme) values (${generateId()}, ${userId}, ${theme}) on conflict (user_id) do update set theme=${theme}`
        await page.evaluate((value) => localStorage.setItem('sim-theme', value), theme)
        for (const width of widths) {
          await page.setViewportSize({ width, height: 1000 })
          await page.goto(new URL(`/workspace/${workspaceId}/files/${fileId}`, base).href, {
            timeout: 360_000,
          })
          await expect(page.locator('.rich-markdown-prose[contenteditable="true"]')).toBeVisible({
            timeout: 120_000,
          })
          await expect
            .poll(() =>
              page.locator('html').evaluate((element) => element.classList.contains('dark'))
            )
            .toBe(theme === 'dark')
          await check(
            `${browserName} ${theme} ${width}: editable table and prose layout`,
            async () => {
              await wideTableProof(page)
              await contained(page)
              await proveCode(page)
              await proveFeatures(page)
            }
          )
          await page.locator('.rich-markdown-prose h1').scrollIntoViewIfNeeded()
          await page.screenshot({
            path: resolve(artifactDir, `${browserName}-${theme}-${width}.png`),
          })
        }
        await check(
          `${browserName} ${theme}: edit and reload an off-screen cell on a narrow screen`,
          () => editLastCell(page, `-${browserName}-${theme}-saved`),
          page
        )
        await check(
          `${browserName} ${theme}: open toolbar follows scrolling and control resizing`,
          () => proveToolbarTracking(page),
          page
        )
        if (theme === 'light')
          await check(
            `${browserName}: collaborator names stay inside locally scrolled tables`,
            () => proveCollaborationScroll(page),
            page
          )
        if (theme === 'light')
          await check(
            `${browserName}: collaborator name stays visible above the first row`,
            () => proveCollaborationCursor(page),
            page
          )
      }
    } finally {
      await browser.close()
    }
  }
} catch (error) {
  checks.push({
    name: 'Harness completion',
    passed: false,
    durationMs: 0,
    error: getErrorMessage(error),
  })
} finally {
  await check('No uncaught browser errors', async () => assert.deepEqual(errors, []))
  await check('Fixture cleanup', async () => {
    if (fileId) await request(`/api/workspaces/${workspaceId}/files/${fileId}`, undefined, 'DELETE')
    await sql`delete from public_share where id=${shareId}`
    await sql`delete from workspace where id=${workspaceId}`
    await sql`delete from project where id=${workspaceId}`
    await sql`delete from "user" where id=${userId}`
  })
  await sql.end()
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks, errors, artifactDir }, null, 2))
  process.exitCode = checks.some((check) => !check.passed) ? 1 : 0
}
