import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { chromium, expect, type Locator, type Page, webkit } from '@playwright/test'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId, generateShortId } from '@sim/utils/id'
import { toRecord } from '@sim/utils/object'
import type { TiptapEditorHTMLElement } from '@tiptap/core'
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
// Keep the polling verifier's public content quota separate from browser visitors.
const verifierIp = `2001:db8:${Array.from(crypto.getRandomValues(new Uint16Array(6)), (value) => value.toString(16)).join(':')}`
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
    headers: {
      Cookie: cookieHeader,
      Origin: base.origin,
      'Content-Type': 'application/json',
      'X-Forwarded-For': verifierIp,
    },
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
    const browserState = await page
      ?.evaluate(() => {
        const selection = getSelection()
        const editable = document.querySelector('.rich-markdown-prose[contenteditable="true"]')
        return {
          url: location.href,
          body: document.body.innerText.slice(0, 2000),
          documentFocused: document.hasFocus(),
          editorFocused: document.activeElement === editable,
          activeTag: document.activeElement?.tagName,
          selection: selection?.toString().slice(0, 160),
          selectionInEditor: Boolean(
            editable && selection?.anchorNode && editable.contains(selection.anchorNode)
          ),
          textMenus: [...document.querySelectorAll('[aria-label="Text formatting"]')].map(
            (element) => {
              const popup = element.parentElement
              const bounds = popup?.getBoundingClientRect()
              const style = popup && getComputedStyle(popup)
              return {
                connected: element.isConnected,
                display: style?.display,
                visibility: style?.visibility,
                x: bounds?.x,
                y: bounds?.y,
                width: bounds?.width,
              }
            }
          ),
        }
      })
      .catch(() => null)
    checks.push({
      name,
      passed: false,
      durationMs: performance.now() - start,
      error: `${getErrorMessage(error)}${browserState ? `\nBrowser state: ${JSON.stringify(browserState)}` : ''}`,
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
    await longCell.evaluate(
      (element) =>
        element.getBoundingClientRect().width <=
        Math.max(321, element.closest('.tableWrapper')?.clientWidth ?? 0)
    ),
    'A long token expands its column without a bound'
  )
  const aligned = page.locator('.rich-markdown-prose table').filter({ hasText: 'Escaped | pipe' })
  assert(
    await aligned.evaluate(
      (element) =>
        element.getBoundingClientRect().width >=
        (element.closest('.tableWrapper')?.clientWidth ?? Number.POSITIVE_INFINITY) - 1
    ),
    'A short table no longer fills the reading column'
  )
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
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('.rich-markdown-prose').filter({ visible: true })).toContainText(
    marker,
    { timeout: 120_000 }
  )
  await contained(page)
  await expect(page.locator('.rich-markdown-prose[contenteditable="true"]')).toBeVisible({
    timeout: 120_000,
  })
  await page.bringToFront()
  await page
    .locator('.rich-markdown-prose strong')
    .filter({ hasText: /^bold$/ })
    .click()
  await expect(page.locator('.rich-markdown-prose[contenteditable="true"]')).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Shift+ArrowRight')
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString().trim() ?? ''), {
      message: 'Keyboard selection did not select text',
    })
    .not.toBe('')
  await proveToolbar(page, page.getByRole('toolbar', { name: 'Text formatting' }))
  await page.keyboard.press('ArrowRight')
}

async function provePastePersistence(page: Page, browserName: string) {
  const created = toRecord(
    toRecord(
      await (
        await request(`/api/workspaces/${workspaceId}/files`, {
          name: `clipboard-${browserName}.md`,
          content: 'Clipboard proof\n\nStart here.',
          contentType: 'text/markdown',
        })
      ).json()
    ).file
  )
  assert.equal(typeof created.id, 'string')
  const pastedFileId = String(created.id)
  const pastedShareId = generateId()
  const pastedShareToken = generateShortId()
  const readPasteSource = async () =>
    (await request(`/api/files/public/${pastedShareToken}/content`)).text()
  try {
    await sql`insert into public_share (id, resource_type, resource_id, entity_type, entity_id, workspace_id, created_by, token) values (${pastedShareId}, 'file', ${pastedFileId}, 'workspace', ${workspaceId}, ${workspaceId}, ${userId}, ${pastedShareToken})`
    await page.goto(new URL(`/workspace/${workspaceId}/files/${pastedFileId}`, base).href, {
      waitUntil: 'domcontentloaded',
    })
    const editor = page.locator('.rich-markdown-prose[contenteditable="true"]')
    await expect(editor).toBeVisible({ timeout: 120_000 })
    await expect(editor).toContainText('Start here.')
    const marker = `paste-${browserName}`
    const focusLastParagraph = async () => {
      await editor.locator(':scope > p').last().click()
      await expect
        .poll(() =>
          editor.evaluate((element) => {
            const state = (element as TiptapEditorHTMLElement).editor?.state
            if (!state) return false
            const { doc, selection } = state
            return selection.$from.depth === 1 && selection.$from.index(0) === doc.childCount - 1
          })
        )
        .toBe(true)
    }
    const paste = async (data: Record<string, string>, plain = false) => {
      await focusLastParagraph()
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
      await page.keyboard.press('Enter')
      await editor.evaluate(
        (element, { representations, plain }) => {
          const key = { key: 'v', keyCode: 86, ctrlKey: true, shiftKey: true, bubbles: true }
          if (plain) element.dispatchEvent(new KeyboardEvent('keydown', key))
          try {
            const clipboardData = new DataTransfer()
            for (const [type, text] of Object.entries(representations))
              clipboardData.setData(type, text)
            element.dispatchEvent(
              new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })
            )
          } finally {
            if (plain) element.dispatchEvent(new KeyboardEvent('keyup', key))
          }
        },
        { representations: data, plain }
      )
    }
    await paste({
      'text/plain': [
        `${marker} title\n==================`,
        '~~~js\nconst pastedAnswer = 42\n~~~',
        '1) Pasted first\n2) Pasted second',
        `[${marker} guide][paste-ref]\n\n[paste-ref]: https://example.test/guide`,
        `| ${marker} measure<br> | Value<br> |\n| --- | --- |\n| Quality<br> | **98.7**<br> |`,
      ].join('\n\n'),
    })
    await expect(editor.locator('h1').filter({ hasText: `${marker} title` })).toBeVisible()
    await expect(
      editor.locator('pre').filter({ hasText: 'const pastedAnswer = 42' }).last()
    ).toBeVisible()
    await expect(
      editor.locator(`a[href="https://example.test/guide"]`).filter({ hasText: `${marker} guide` })
    ).toBeVisible()
    const pastedTable = editor.locator('table').filter({ hasText: `${marker} measure` })
    await expect(pastedTable.locator('strong')).toHaveText('98.7')
    await expect(
      pastedTable.locator('th').first().locator('br:not(.ProseMirror-trailingBreak)')
    ).toHaveCount(1)
    await paste({
      'text/plain': 'Fallback representation',
      'text/html': '<p>Wrong representation</p>',
      'text/markdown': `## ${marker} explicit`,
    })
    await expect(editor.locator('h2').filter({ hasText: `${marker} explicit` })).toBeVisible()
    await paste({
      'text/plain': 'Label\tValue\n**literal**\t42',
      'text/html': `<table><tr><th>${marker} HTML</th><th>Value</th></tr><tr><td>**literal**</td><td>42</td></tr></table>`,
    })
    const htmlTable = editor.locator('table').filter({ hasText: `${marker} HTML` })
    await expect(htmlTable).toContainText('**literal**')
    await expect(htmlTable.locator('strong')).toHaveCount(0)
    await paste({
      'text/plain': `const ${browserName}Clipboard = "<literal>"`,
      'text/html': `<pre>const ${browserName}Clipboard = &quot;&lt;literal&gt;&quot;</pre>`,
      'vscode-editor-data': JSON.stringify({ mode: 'javascript' }),
    })
    await expect(
      editor.locator('pre').filter({ hasText: `const ${browserName}Clipboard` })
    ).toContainText('"<literal>"')
    await paste({ 'text/plain': 'List<Code>' })
    const genericParagraph = editor.locator(':scope > p').filter({ hasText: /^List<Code>$/ })
    await expect(genericParagraph).toHaveCount(1)
    await paste(
      { 'text/plain': `**${marker} literal**`, 'text/html': `<b>${marker} literal</b>` },
      true
    )
    await expect(editor.locator(':scope > p').last()).toHaveText(`**${marker} literal**`)
    await expect.poll(readPasteSource, { timeout: 30_000 }).toContain(`${marker} literal`)
    const saved = await readPasteSource()
    for (const preserved of [
      `# ${marker} title`,
      'const pastedAnswer = 42',
      `[${marker} guide](https://example.test/guide)`,
      `${marker} measure<br>`,
      `## ${marker} explicit`,
      `\\*\\*${marker} literal\\*\\*`,
    ])
      assert(saved.includes(preserved), `Pasted content did not persist: ${preserved}`)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(editor).toBeVisible({ timeout: 120_000 })
    await expect(editor.locator('h1').filter({ hasText: `${marker} title` })).toBeVisible()
    await expect(editor.locator('table').filter({ hasText: `${marker} measure` })).toContainText(
      '98.7'
    )
    await expect(editor.locator(':scope > p').last()).toHaveText(`**${marker} literal**`)
    await contained(page)
    await expect(genericParagraph).toHaveCount(1)
    await page.screenshot({ path: resolve(artifactDir, `${browserName}-paste-reopened.png`) })
    const metadata = toRecord(
      toRecord(await (await request(`/api/workspaces/${workspaceId}/files/${pastedFileId}`)).json())
        .file
    )
    const remoteMarker = `${marker} external update`
    await request(
      `/api/workspaces/${workspaceId}/files/${pastedFileId}/content`,
      {
        content: `${await readPasteSource()}\n\n## ${remoteMarker}\n\nRemote paragraph.`,
        expectedUpdatedAt: metadata.contentUpdatedAt ?? metadata.updatedAt,
      },
      'PUT'
    )
    await expect(editor.locator('h2').filter({ hasText: remoteMarker })).toBeVisible({
      timeout: 30_000,
    })
    await focusLastParagraph()
    await page.keyboard.press('End')
    await page.keyboard.insertText(` ${marker} after external update`)
    await expect
      .poll(readPasteSource, { timeout: 30_000 })
      .toContain(`${marker} after external update`)
    const afterLocalEdit = await readPasteSource()
    await expect(genericParagraph).toHaveCount(1)
    assert(afterLocalEdit.includes(`## ${remoteMarker}`), 'Local edit lost the external update')
    assert(
      afterLocalEdit.includes(`${marker} measure<br>`),
      'External update lost the pasted table'
    )
  } finally {
    try {
      await request(`/api/workspaces/${workspaceId}/files/${pastedFileId}`, undefined, 'DELETE')
    } finally {
      await sql`delete from public_share where id=${pastedShareId}`
    }
  }
}

/** Cached routes reconnect effects before useEditor replaces its disposed editor instance. */
async function proveWarmNavigation(page: Page, browserName: string) {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const restoredShareId = generateId()
  const restoredShareToken = generateShortId()
  const folderName = `Navigation ${browserName}`
  const createdFolder = toRecord(
    toRecord(
      await (
        await request(`/api/workspaces/${workspaceId}/files/folders`, { name: folderName })
      ).json()
    ).folder
  )
  assert.equal(typeof createdFolder.id, 'string')
  const folderId = String(createdFolder.id)
  const files: { id: string; name: string }[] = []
  const caughtErrors: string[] = []
  const captureError = (message: import('@playwright/test').ConsoleMessage) => {
    if (message.type() !== 'error') return
    const text = message.text()
    // Some WebKit builds log the existing viewport option at error severity.
    if (
      browserName === 'webkit' &&
      text === 'Viewport argument key "interactive-widget" not recognized and ignored.'
    )
      return
    caughtErrors.push(text)
  }
  page.on('console', captureError)
  try {
    for (const label of ['Origin', 'Destination']) {
      const name = `navigation-${browserName}-${label.toLowerCase()}.md`
      const created = toRecord(
        toRecord(
          await (
            await request(`/api/workspaces/${workspaceId}/files`, {
              name,
              folderId,
              content: `# ${label} document\n\nA stable [navigation link](https://example.test/navigation).\n\n| Name | Value |\n| --- | --- |\n| Original row | Kept |\n\nLast paragraph.`,
              contentType: 'text/markdown',
            })
          ).json()
        ).file
      )
      assert.equal(typeof created.id, 'string')
      files.push({ id: String(created.id), name })
    }
    const origin = files[0]
    const destination = files[1]
    await sql`insert into public_share (id, resource_type, resource_id, entity_type, entity_id, workspace_id, created_by, token) values (${restoredShareId}, 'file', ${origin.id}, 'workspace', ${workspaceId}, ${workspaceId}, ${userId}, ${restoredShareToken})`
    await page.goto(
      new URL(`/workspace/${workspaceId}/files/${origin.id}?folderId=${folderId}`, base).href,
      { waitUntil: 'domcontentloaded' }
    )
    const editor = page.locator('.rich-markdown-prose[contenteditable="true"]')
    await expect(editor).toBeVisible({ timeout: 30_000 })
    for (const keepFindOpen of [false, true]) {
      await editor.evaluate((element) => {
        const instance = (element as TiptapEditorHTMLElement).editor
        if (!instance) throw new Error('The editable surface has no editor instance')
        instance.commands.focus()
        instance.commands.selectAll()
      })
      if (keepFindOpen) {
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f')
        const find = page.getByRole('textbox', { name: 'Find in document', exact: true })
        await find.fill('stable')
      }
      for (const next of [destination, origin]) {
        await page.getByRole('button', { name: folderName, exact: true }).click()
        await page.locator('[data-resource-row]').filter({ hasText: next.name }).click()
        await expect(editor).toBeVisible({ timeout: 30_000 })
        await expect(editor.locator('h1')).toHaveText(
          next === origin ? 'Origin document' : 'Destination document'
        )
      }
    }
    // Restored controls must bind to the replacement editor, including their keyboard listeners.
    const find = page.getByRole('textbox', { name: 'Find in document', exact: true })
    if (await find.isVisible())
      await page.getByRole('button', { name: 'Close find', exact: true }).click()
    const lastParagraph = editor.locator(':scope > p').filter({ hasText: /^Last paragraph\.$/ })
    await lastParagraph.evaluate((element) => {
      const instance = (element.closest('.rich-markdown-prose') as TiptapEditorHTMLElement).editor
      if (!instance) throw new Error('The restored paragraph has no editor instance')
      instance
        .chain()
        .focus()
        .setTextSelection(instance.view.posAtDOM(element, element.childNodes.length))
        .run()
    })
    await expect(editor).toBeFocused()
    await page.keyboard.press('Enter')
    await page.keyboard.type('/h2')
    const commands = page.getByRole('listbox', { name: 'Commands', exact: true })
    await expect(commands.getByRole('option')).toHaveCount(1)
    await expect(commands.getByRole('option')).toContainText('Heading 2')
    await page.keyboard.press('Enter')
    const restoredHeading = `Restored document controls ${browserName}`
    await page.keyboard.insertText(restoredHeading)
    const heading = editor.locator('h2').filter({ hasText: restoredHeading })
    await expect(heading).toHaveText(restoredHeading)
    await expect(commands).toHaveCount(0)

    await lastParagraph.evaluate((element) => {
      const instance = (element.closest('.rich-markdown-prose') as TiptapEditorHTMLElement).editor
      if (!instance) throw new Error('The restored paragraph has no editor instance')
      instance
        .chain()
        .focus()
        .setTextSelection({
          from: instance.view.posAtDOM(element, 0),
          to: instance.view.posAtDOM(element, element.childNodes.length),
        })
        .run()
    })
    await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('Last paragraph.')
    await page.keyboard.press('Alt+F10')
    const toolbar = page.getByRole('toolbar', { name: 'Text formatting', exact: true })
    await expect
      .poll(() => toolbar.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true)
    await toolbar.getByRole('button', { name: 'Bold', exact: true }).click()
    await expect(lastParagraph.locator('strong')).toHaveText('Last paragraph.')
    await expect(editor).toBeFocused()

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f')
    await find.fill('document')
    await expect(page.getByText('1 of 2', { exact: true })).toBeVisible()
    await expect(editor.locator('.rich-find-match')).toHaveCount(2)
    await expect(editor.locator('h1 .rich-find-match-active')).toHaveText('document')
    await find.press('Enter')
    await expect(page.getByText('2 of 2', { exact: true })).toBeVisible()
    await expect(heading.locator('.rich-find-match-active')).toHaveText('document')
    await find.press('Shift+Enter')
    await expect(page.getByText('1 of 2', { exact: true })).toBeVisible()
    await expect(editor.locator('h1 .rich-find-match-active')).toHaveText('document')
    await page.getByRole('button', { name: 'Close find', exact: true }).click()
    await expect(editor.locator('.rich-find-match')).toHaveCount(0)

    // The restored collaboration room persists both control edits and subsequent typing.
    await heading.evaluate((element) => {
      const instance = (element.closest('.rich-markdown-prose') as TiptapEditorHTMLElement).editor
      if (!instance) throw new Error('The restored heading has no editor instance')
      instance
        .chain()
        .focus()
        .setTextSelection(instance.view.posAtDOM(element, element.childNodes.length))
        .run()
    })
    await expect(editor).toBeFocused()
    const marker = ` persisted after cached navigation ${browserName}`
    await page.keyboard.insertText(marker)
    const readRestoredSource = async () =>
      (await request(`/api/files/public/${restoredShareToken}/content`)).text()
    await expect.poll(readRestoredSource, { timeout: 30_000 }).toContain(marker)
    const saved = await readRestoredSource()
    assert.equal(
      saved.match(/^# Origin document$/gm)?.length,
      1,
      'Navigation duplicated the document'
    )
    assert(saved.includes('[navigation link](https://example.test/navigation)'))
    assert(saved.includes('Original row'))
    assert(saved.includes('**Last paragraph.**'), 'Restored toolbar formatting did not persist')
    assert(saved.includes(`## ${restoredHeading}`), 'Restored slash command did not persist')
    assert(!saved.includes('/h2'), 'The slash query remained in the saved document')
    await editor.getByRole('link', { name: 'navigation link' }).hover()
    await expect(page.getByRole('dialog', { name: 'Link', exact: true })).toBeVisible()
    assert.deepEqual(caughtErrors, [], 'Cached navigation raised a caught browser error')
    await page.screenshot({ path: resolve(artifactDir, `navigation-${browserName}.png`) })
  } finally {
    page.off('console', captureError)
    const deletions = await Promise.allSettled(
      files.map((file) =>
        request(`/api/workspaces/${workspaceId}/files/${file.id}`, undefined, 'DELETE')
      )
    )
    const cleanup = await Promise.allSettled([
      sql`delete from public_share where id=${restoredShareId}`,
      sql`delete from folder where id=${folderId} and workspace_id=${workspaceId}`,
    ])
    for (const deletion of [...deletions, ...cleanup]) {
      assert.equal(
        deletion.status,
        'fulfilled',
        deletion.status === 'rejected' ? getErrorMessage(deletion.reason) : undefined
      )
    }
  }
}

async function proveCollaborationCursor(page: Page) {
  const peer = await page.context().newPage()
  peer.on('pageerror', (error) => errors.push(error.message))
  try {
    await peer.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 360_000 })
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
    await page.bringToFront()
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
    const distanceFromSelection = () =>
      popup.evaluate((element) => {
        const selection = getSelection()
        if (!selection?.rangeCount) return Number.POSITIVE_INFINITY
        const rect = selection.getRangeAt(0).getBoundingClientRect()
        const bounds = element.getBoundingClientRect()
        return Math.abs((bounds.left + bounds.right - rect.left - rect.right) / 2)
      })
    await expect
      .poll(distanceFromSelection, { message: 'Toolbar follows selection after controls resize' })
      .toBeLessThan(2)
    await page.setViewportSize({ width: 1400, height: 1000 })
    await expect
      .poll(distanceFromSelection, { message: 'Toolbar follows selection after viewport resize' })
      .toBeLessThan(2)
    const movement = await table.evaluate((element) => {
      const wrapper = element.parentElement
      if (!wrapper) throw new Error('Missing table viewport')
      const from = wrapper.scrollLeft
      wrapper.scrollLeft += 64
      return { from, delta: wrapper.scrollLeft - from }
    })
    assert(movement.delta > 32, 'The table did not move with its toolbar open')
    await expect
      .poll(distanceFromSelection, { message: 'Toolbar follows selection after scrolling forward' })
      .toBeLessThan(2)
    await table.evaluate((element, left) => {
      if (element.parentElement) element.parentElement.scrollLeft = left
    }, movement.from)
    await expect
      .poll(distanceFromSelection, { message: 'Toolbar follows selection after scrolling back' })
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
    await peer.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 360_000 })
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
    await page.bringToFront()
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
        await page.goto(new URL(`/f/${shareToken}`, base).href, {
          waitUntil: 'domcontentloaded',
          timeout: 360_000,
        })
        await check(
          `${browserName} public ${width}: readable and reachable wide columns`,
          () => wideTableProof(page),
          page
        )
        await check(
          `${browserName} public ${width}: prose and long content stay contained`,
          () => contained(page),
          page
        )
        await check(
          `${browserName} public ${width}: long code scrolls`,
          () => proveCode(page),
          page
        )
        await check(
          `${browserName} public ${width}: alignment, images, and diagrams`,
          () => proveFeatures(page),
          page
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
            waitUntil: 'domcontentloaded',
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
      await check(
        `${browserName}: Markdown and rich HTML paste survive collaboration and reload`,
        () => provePastePersistence(page, browserName),
        page
      )
      await check(
        `${browserName}: cached file navigation restores editing, menus, and persistence`,
        () => proveWarmNavigation(page, browserName),
        page
      )
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
    try {
      if (fileId)
        await request(`/api/workspaces/${workspaceId}/files/${fileId}`, undefined, 'DELETE')
    } finally {
      await sql`delete from public_share where id=${shareId}`
      await sql`delete from workspace where id=${workspaceId}`
      await sql`delete from project where id=${workspaceId}`
      await sql`delete from "user" where id=${userId}`
    }
  })
  await sql.end()
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ checks, errors, artifactDir }, null, 2))
  process.exitCode = checks.some((check) => !check.passed) ? 1 : 0
}
