import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { json } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { type Browser, chromium, webkit } from '@playwright/test'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { interruptibleSleep } from '@sim/utils/helpers'
import { toRecord } from '@sim/utils/object'
import { Document, Packer, Paragraph } from 'docx'
import { build } from 'esbuild'
import { PDFDocument } from 'pdf-lib'
import PptxGenJS from 'pptxgenjs'
import * as XLSX from 'xlsx'
import { buildMcpAppFrame } from '@/lib/mcp/app-frame'

/** Exercises the production sandbox with the real SDK: handshake, isolation, CSP, source checks and teardown. */
const logger = createLogger('McpAppE2E')
const reportPath = process.env.MCP_APP_E2E_REPORT_PATH
assert(reportPath, 'MCP_APP_E2E_REPORT_PATH must be provided')
const browserName = process.env.MCP_APP_E2E_BROWSER ?? 'chromium'
assert(browserName === 'chromium' || browserName === 'webkit', 'Unsupported MCP App browser')
await writeFile(
  reportPath,
  JSON.stringify({
    checks: [{ name: 'Setup', passed: false, error: 'Browser fixture setup did not complete' }],
  })
)
const directory = await mkdtemp(path.join(tmpdir(), 'sim-mcp-app-'))
const checks: { name: string; passed: boolean; durationMs: number; error?: string }[] = []
const browserErrors: { message: string; stack?: string }[] = []
let calls = 0
let blockedRequests = 0
const toolRequests: unknown[] = []
const resourceRequests: unknown[] = []

async function bundleFile(entry: string, output: string) {
  await build({
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    ignoreAnnotations: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    external: ['node:async_hooks'],
    loader: { '.ttf': 'dataurl' },
    jsx: 'automatic',
    tsconfig: path.join(import.meta.dirname, '../tsconfig.json'),
    alias: { 'node:buffer': fileURLToPath(import.meta.resolve('buffer/')) },
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
    plugins: [
      {
        name: 'fixture-next-font',
        setup(builder) {
          builder.onResolve({ filter: /^next\/font\/(google|local)$/ }, () => ({
            path: 'font',
            namespace: 'fixture-next-font',
          }))
          builder.onLoad({ filter: /.*/, namespace: 'fixture-next-font' }, () => ({
            contents:
              'export const Inter = () => ({ className: "", style: { fontFamily: "sans-serif" } }); export default Inter;',
            loader: 'js',
          }))
        },
      },
    ],
  })
  return readFile(output, 'utf8')
}

async function bundle(name: string, source: string) {
  const entry = path.join(directory, `${name}.ts`)
  await writeFile(entry, source)
  return bundleFile(entry, path.join(directory, `${name}.js`))
}

let browser: Browser | undefined
let server: Server | undefined
let captureFailure: (() => Promise<unknown>) | undefined
try {
  const pdf = await PDFDocument.create()
  pdf.addPage().drawText('MCP PDF preview')
  const pdfBytes = await pdf.save()
  const docxBytes = await Packer.toBuffer(
    new Document({ sections: [{ children: [new Paragraph('MCP document content')] }] })
  )
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['Report', 'Value'],
      ['MCP worksheet content', 42],
    ]),
    'Report'
  )
  const spreadsheetBytes: Buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  const slides = new PptxGenJS()
  slides.addSlide().addText('MCP slide content', { x: 1, y: 1, w: 6, h: 1 })
  const slideBytes = await slides.write({ outputType: 'nodebuffer' })
  assert(Buffer.isBuffer(slideBytes))
  const audioBytes = Buffer.alloc(8044, 128)
  audioBytes.write('RIFF', 0)
  audioBytes.writeUInt32LE(8036, 4)
  audioBytes.write('WAVEfmt ', 8)
  audioBytes.writeUInt32LE(16, 16)
  audioBytes.writeUInt16LE(1, 20)
  audioBytes.writeUInt16LE(1, 22)
  audioBytes.writeUInt32LE(8000, 24)
  audioBytes.writeUInt32LE(8000, 28)
  audioBytes.writeUInt16LE(1, 32)
  audioBytes.writeUInt16LE(8, 34)
  audioBytes.write('data', 36)
  audioBytes.writeUInt32LE(8000, 40)
  const artifacts = [
    { mimeType: 'application/pdf', title: 'Report.pdf', bytes: pdfBytes, kind: 'file' },
    {
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      title: 'Report.docx',
      bytes: docxBytes,
      kind: 'file',
    },
    {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      title: 'Report.xlsx',
      bytes: spreadsheetBytes,
      kind: 'file',
    },
    {
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      title: 'Report.pptx',
      bytes: slideBytes,
      kind: 'file',
    },
    {
      mimeType: 'video/mp4',
      title: 'Report.mp4',
      bytes: await readFile(path.join(import.meta.dirname, 'fixtures/mcp-video.mp4')),
      kind: 'file',
    },
    { mimeType: 'audio/wav; codecs=1', title: 'Report.wav', bytes: audioBytes, kind: 'audio' },
  ]
  const assetRequests: number[] = []
  const appModule = fileURLToPath(import.meta.resolve('@modelcontextprotocol/ext-apps'))
  const bridgeModule = fileURLToPath(
    import.meta.resolve('@modelcontextprotocol/ext-apps/app-bridge')
  )
  const appScript = await bundle(
    'app',
    `
import { App } from ${JSON.stringify(appModule)};
const app = new App({ name: 'Fixture', version: '1' }, {});
const state = {};
const show = () => { document.querySelector('pre').textContent = JSON.stringify(state); };
app.ontoolinput = ({ arguments: args }) => { state.input = args; show(); };
app.ontoolresult = async (result) => {
  state.privateData = result._meta.privateData;
  state.result = result.structuredContent.total;
  try { parent.document.body; state.parentBlocked = false; } catch { state.parentBlocked = true; }
  try { top.document.cookie; state.cookiesBlocked = false; } catch { state.cookiesBlocked = true; }
  try { localStorage.getItem('fixture'); state.storageBlocked = false; } catch { state.storageBlocked = true; }
  try { globalThis.eval('1 + 1'); state.evalBlocked = false; } catch { state.evalBlocked = true; }
  state.allowed = await fetch('https://allowed.test/value').then(r => r.text());
  try { await fetch('https://blocked.test/value'); state.networkBlocked = false; } catch { state.networkBlocked = true; }
  state.tool = await app.callServerTool({ name: 'change_report', arguments: { revision: 2 } });
  state.resource = await app.readServerResource({ uri: 'file:///report.txt' });
  state.ready = true;
  show();
};
app.onhostcontextchanged = (context) => { state.theme = context.theme; show(); };
app.onteardown = async () => { state.closed = true; show(); return {}; };
await app.connect();
`
  )
  const appHtml = `<!doctype html><html><body><h1>MCP report</h1><pre>Opening</pre><script type="module">${appScript.replace(/<\/script/gi, '<\\/script')}</script></body></html>`
  const frame = buildMcpAppFrame(appHtml, {
    ui: { csp: { connectDomains: ['https://allowed.test'] } },
  })
  const hostScript = await bundle(
    'host',
    `
import { AppBridge, PostMessageTransport } from ${JSON.stringify(bridgeModule)};
const frame = document.querySelector('iframe');
const bridge = new AppBridge(null, { name: 'Sim', version: '1' }, { serverTools: {}, serverResources: {} }, { hostContext: { theme: 'light', displayMode: 'inline', availableDisplayModes: ['inline'] } });
window.fixtureBridge = bridge;
window.fixtureCalls = 0;
bridge.onsandboxready = () => bridge.sendSandboxResourceReady({ html: '', sandbox: 'allow-scripts' });
bridge.oninitialized = async () => {
  await bridge.sendToolInput({ arguments: { city: 'Example' } });
  await bridge.sendToolResult({ content: [], structuredContent: { total: 42 }, _meta: { privateData: 'app-only' } });
};
bridge.oncalltool = async (params) => { window.fixtureCalls++; return fetch('/tool', { method: 'POST', body: JSON.stringify(params) }).then(r => r.json()); };
bridge.onreadresource = async () => ({ contents: [{ uri: 'file:///report.txt', text: 'Resource bytes' }] });
await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
frame.src = '/frame';
`
  )
  const reactScript = await bundleFile(
    path.join(import.meta.dirname, 'fixtures/mcp-app.tsx'),
    path.join(directory, 'react.js')
  )
  await bundle(
    'react-loader',
    `import { Buffer } from 'node:buffer'; import Prism from ${JSON.stringify(fileURLToPath(import.meta.resolve('prismjs')))}; globalThis.Buffer = Buffer; globalThis.Prism = Prism; const entry = '/react.js'; await import(entry);`
  )
  server = createServer(async (request, response) => {
    if (request.url === '/frame' || request.url?.endsWith('/frame')) {
      response
        .writeHead(200, {
          'Content-Type': frame.contentType,
          'Content-Security-Policy': frame.policy,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        })
        .end(frame.buffer)
    } else if (request.url === '/attacker') {
      response.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html><script>
        const forge = (id) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'change_report', arguments: { revision: 2 } } });
        parent.frames[0].postMessage(forge('forged-proxy'), '*');
        parent.postMessage(forge('forged-host'), '*');
        parent.postMessage({ attackerReady: true }, '*');
      </script>`)
    } else if (
      request.url === '/react' ||
      request.url === '/preview' ||
      request.url?.startsWith('/artifact?')
    ) {
      response
        .writeHead(200, { 'Content-Type': 'text/html' })
        .end(
          '<!doctype html><html><head><link rel="stylesheet" href="/react.css"></head><body><div id="root"></div><script type="module" src="/react-loader.js"></script></body></html>'
        )
    } else if (request.url === '/react.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(reactScript)
    } else if (request.url?.endsWith('/resources')) {
      resourceRequests.push(await json(request))
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ contents: [{ uri: 'file:///report.txt', text: 'Resource bytes' }] }))
    } else if (/\/assets\/\d+$/.test(request.url ?? '')) {
      const index = Number(request.url?.split('/').at(-1))
      const artifact = artifacts[index]
      if (!artifact) {
        response.writeHead(404).end()
        return
      }
      assetRequests.push(index)
      response.writeHead(200, { 'Content-Type': artifact.mimeType }).end(artifact.bytes)
    } else if (request.url?.startsWith('/api/') && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          workspaceId: 'fixture-workspace',
          receipt: {
            id: 'a'.repeat(64),
            title: 'Report',
            hasApp: true,
            items: artifacts.map(({ mimeType, title, kind }, index) => ({
              index,
              identity: `artifact-${index}`,
              mimeType,
              title,
              kind,
            })),
          },
          arguments: { city: 'Example' },
          result: {
            content: [],
            structuredContent: { total: 42 },
            _meta: { privateData: 'app-only' },
          },
        })
      )
    } else if (request.url === '/host.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(hostScript)
    } else if (request.url === '/tool' || request.url?.endsWith('/tools')) {
      toolRequests.push(await json(request))
      calls++
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ content: [{ type: 'text', text: 'Revision 2' }] }))
    } else if (/^\/[\w.-]+\.(js|css)$/.test(request.url ?? '')) {
      try {
        const filename = path.basename(request.url ?? '')
        const bytes = await readFile(path.join(directory, filename))
        response
          .writeHead(200, {
            'Content-Type': filename.endsWith('.css') ? 'text/css' : 'text/javascript',
          })
          .end(bytes)
      } catch {
        response.writeHead(404).end()
      }
    } else {
      response
        .writeHead(200, {
          'Content-Type': 'text/html',
          'Set-Cookie': 'fixture=private; HttpOnly; SameSite=Strict',
          'Content-Security-Policy':
            "default-src 'none'; script-src 'self'; frame-src 'self'; connect-src 'self'",
        })
        .end(
          '<!doctype html><html><body><h1>Sim MCP App host</h1><iframe title="Report" sandbox="allow-scripts allow-same-origin" width="900" height="600"></iframe><script type="module" src="/host.js"></script></body></html>'
        )
    }
  })
  browser = await (browserName === 'webkit' ? webkit : chromium).launch()

  async function check(name: string, verify: () => Promise<void>) {
    const started = performance.now()
    const controller = new AbortController()
    try {
      await Promise.race([
        verify(),
        interruptibleSleep(30_000, controller.signal).then(() => {
          if (!controller.signal.aborted) throw new Error('Browser check exceeded 30 seconds')
        }),
      ])
      checks.push({ name, passed: true, durationMs: performance.now() - started })
    } catch (error) {
      checks.push({
        name,
        passed: false,
        durationMs: performance.now() - started,
        error: getErrorMessage(error),
      })
      throw error
    } finally {
      controller.abort()
    }
  }

  const runningServer = server
  await new Promise<void>((resolve) => runningServer.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address !== 'string')
  const page = await browser.newPage()
  page.setDefaultTimeout(20_000)
  captureFailure = () => page.screenshot({ path: `${reportPath}.png`, fullPage: true })
  page.on('pageerror', (error) => {
    browserErrors.push({ message: error.message, stack: error.stack })
    logger.error('Browser fixture error', { message: error.message, stack: error.stack })
  })
  await page.route('https://allowed.test/**', (route) =>
    route.fulfill({ body: 'Allowed bytes', headers: { 'Access-Control-Allow-Origin': '*' } })
  )
  await page.route('https://blocked.test/**', (route) => {
    blockedRequests++
    return route.fulfill({ body: 'Unexpected', headers: { 'Access-Control-Allow-Origin': '*' } })
  })
  await page.goto(`http://127.0.0.1:${address.port}`)
  await check('Real App handshake, private data, tools and resources', async () => {
    const content = page.frameLocator('iframe').frameLocator('iframe').locator('pre')
    await content.filter({ hasText: '"ready":true' }).waitFor({ timeout: 20_000 })
    const result = JSON.parse(await content.innerText())
    assert.deepEqual(result.input, { city: 'Example' })
    assert.equal(result.privateData, 'app-only')
    assert.equal(result.result, 42)
    assert.equal(result.tool.content[0].text, 'Revision 2')
    assert.equal(result.resource.contents[0].text, 'Resource bytes')
    assert.equal(calls, 1)
  })
  await check('Opaque origins and declared network policy', async () => {
    const result = JSON.parse(
      await page.frameLocator('iframe').frameLocator('iframe').locator('pre').innerText()
    )
    for (const name of [
      'parentBlocked',
      'cookiesBlocked',
      'storageBlocked',
      'evalBlocked',
      'networkBlocked',
    ])
      assert.equal(result[name], true, name)
    assert.equal(result.allowed, 'Allowed bytes')
    assert.equal(blockedRequests, 0)
    const proxy = page.frames().find((candidate) => candidate.url().endsWith('/frame'))
    assert(proxy)
    assert.equal(
      await proxy.evaluate(() => {
        try {
          parent.document.body
          return false
        } catch {
          return true
        }
      }),
      true
    )
  })
  await check('Foreign-window messages, theme update and teardown', async () => {
    const attacker = await page.evaluate(async () => {
      const frame = document.createElement('iframe')
      frame.sandbox = 'allow-scripts'
      frame.src = '/attacker'
      await new Promise<void>((resolve) => {
        const listener = (event: MessageEvent) => {
          if (event.source !== frame.contentWindow || !event.data?.attackerReady) return
          window.removeEventListener('message', listener)
          resolve()
        }
        window.addEventListener('message', listener)
        document.body.append(frame)
      })
      return true
    })
    assert(attacker)
    await page.waitForTimeout(250)
    assert.equal(calls, 1)
    await page.locator('iframe[src="/attacker"]').evaluate((element) => element.remove())
    await page.evaluate(async () => {
      if (!('fixtureBridge' in window)) throw new Error('Missing App bridge')
      const bridge = window.fixtureBridge as {
        setHostContext: (value: {
          theme: 'dark'
          displayMode: 'inline'
          availableDisplayModes: ['inline']
        }) => void
        teardownResource: (params: object) => Promise<unknown>
      }
      window.postMessage(
        { jsonrpc: '2.0', id: 'forged', method: 'tools/call', params: { name: 'change_report' } },
        '*'
      )
      bridge.setHostContext({
        theme: 'dark',
        displayMode: 'inline',
        availableDisplayModes: ['inline'],
      })
      await bridge.teardownResource({})
    })
    const result = JSON.parse(
      await page.frameLocator('iframe').frameLocator('iframe').locator('pre').innerText()
    )
    assert.equal(result.theme, 'dark')
    assert.equal(result.closed, true)
    assert.equal(
      await page.evaluate(() => ('fixtureCalls' in window ? window.fixtureCalls : undefined)),
      1
    )
    assert.equal(calls, 1)
  })
  await check(
    'Production React card and App host open, close and reopen under StrictMode',
    async () => {
      const before = calls
      await page.goto(`http://127.0.0.1:${address.port}/react`)
      await page.getByRole('button', { name: 'Open Report', exact: true }).focus()
      await page.keyboard.press('Enter')
      const content = page.frameLocator('iframe').frameLocator('iframe').locator('pre')
      await content.filter({ hasText: '"ready":true' }).waitFor({ timeout: 20_000 })
      assert.deepEqual(JSON.parse(await content.innerText()).input, { city: 'Example' })
      assert.equal(calls, before + 1)
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Open Report')
      await page.getByRole('button', { name: 'Close app', exact: true }).click()
      await page.locator('iframe').waitFor({ state: 'detached' })
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Open Report')
      await page.getByRole('button', { name: 'Open Report', exact: true }).click()
      await content.filter({ hasText: '"ready":true' }).waitFor({ timeout: 20_000 })
      assert.equal(calls, before + 2)
    }
  )
  assert(toolRequests.length > 0 && resourceRequests.length > 0)
  for (const request of toolRequests) {
    const input = toRecord(request)
    assert.deepEqual(
      { name: input.name, arguments: input.arguments },
      { name: 'change_report', arguments: { revision: 2 } }
    )
  }
  for (const request of resourceRequests) assert.deepEqual(request, { uri: 'file:///report.txt' })
  await check('Committed binary previews fetch without reported file size', async () => {
    await page.goto(`http://127.0.0.1:${address.port}/preview`)
    await page.getByText('ready:%PDF-', { exact: true }).waitFor({ timeout: 20_000 })
  })
  for (const [index, text] of [
    [1, 'MCP document content'],
    [2, 'MCP worksheet content'],
    [3, 'MCP slide content'],
  ] as const) {
    await check(`Native ${artifacts[index].title} preview renders document bytes`, async () => {
      await page.goto(`http://127.0.0.1:${address.port}/artifact?index=${index}`)
      await page.getByText(text, { exact: true }).waitFor({ timeout: 20_000 })
      assert(assetRequests.includes(index))
    })
  }
  for (const [index, tag] of [
    [4, 'video'],
    [5, 'audio'],
  ] as const) {
    await check(`Native ${tag} preview decodes and plays artifact bytes`, async () => {
      await page.goto(`http://127.0.0.1:${address.port}/artifact?index=${index}`)
      const media = page.locator(tag)
      await media.waitFor({ timeout: 20_000 })
      await media.evaluate(async (element) => {
        if (!(element instanceof HTMLMediaElement)) throw new Error('Missing media element')
        element.muted = true
        await element.play()
      })
      await page.waitForFunction(
        (tag) => {
          const media = document.querySelector(tag)
          return media instanceof HTMLMediaElement && media.currentTime > 0 && media.error === null
        },
        tag,
        { timeout: 20_000 }
      )
      assert(assetRequests.includes(index))
    })
  }
  await page.screenshot({ path: `${reportPath}.png`, fullPage: true })
  await check('Browser completes without uncaught runtime errors', async () => {
    assert.deepEqual(browserErrors, [])
  })
  logger.info('MCP App browser checks passed', { count: checks.length, reportPath })
} catch (error) {
  if (!checks.some((check) => !check.passed))
    checks.push({ name: 'Setup', passed: false, durationMs: 0, error: getErrorMessage(error) })
  await captureFailure?.().catch(() => undefined)
  throw error
} finally {
  const runningServer = server
  const results = await Promise.allSettled([
    writeFile(reportPath, JSON.stringify({ checks, browserErrors }, null, 2)),
    browser?.close(),
    runningServer
      ? new Promise<void>((resolve) => {
          runningServer.close(() => resolve())
          runningServer.closeAllConnections()
        })
      : Promise.resolve(),
    rm(directory, { recursive: true, force: true }),
  ])
  for (const result of results) {
    if (result.status === 'rejected') {
      logger.error('MCP App fixture cleanup failed', { error: getErrorMessage(result.reason) })
      process.exitCode = 1
    }
  }
}
