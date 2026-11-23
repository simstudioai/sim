import { spawnSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { type BrowserContext, chromium, expect, type Frame, type Page } from '@playwright/test'
import {
  type AppToExtensionMessage,
  extensionToAppMessageSchema,
  pageSnapshotSchema,
  SIM_LINK_HOSTS,
  SIM_LINK_SUGGESTIONS_PATH,
} from '@sim/browser-extension-protocol'
import { SecretReveal } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { renderToStaticMarkup } from 'react-dom/server'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const logger = createLogger('BrowserExtensionE2E')
const reportPath = process.env.EXTENSION_REPORT_PATH
if (!reportPath) throw new Error('Set EXTENSION_REPORT_PATH to the output JSON report path.')
const output = resolve(root, reportPath)
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const secretReveal = renderToStaticMarkup(
  createElement(SecretReveal, { value: 'SECRET_REVEAL_SENTINEL' })
)
let linksChecks = 0
let shortHostVisits = 0
const fixture = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/sign-in')
      return new Response('Fixture session created', {
        headers: { 'set-cookie': 'fixture-session=present; Path=/; HttpOnly; SameSite=Lax' },
      })
    if (url.pathname === SIM_LINK_SUGGESTIONS_PATH) {
      linksChecks += 1
      return Response.json({
        enabled: request.headers.get('cookie')?.includes('fixture-session=present') === true,
        links: [],
      })
    }
    if (url.pathname === '/sim/') shortHostVisits += 1
    if (url.pathname === '/extension')
      return new Response(
        `<!doctype html><html><body>
      <h1>Sim bridge fixture</h1><p>Packaged extension transport verification</p><pre id="received">[]</pre>
      <p id="session">${request.headers.get('cookie')?.includes('fixture-session=present') ? 'present' : 'missing'}</p>
      <script>
        const received = [];
        window.addEventListener('message', event => {
          if (event.source !== parent || !event.origin.startsWith('chrome-extension://')) return;
          if (event.data.type === 'e2e-barrier') document.body.dataset.barrierId = event.data.id;
          if (event.data.type === 'connected') {
            document.body.dataset.connected = event.data.sessionId;
            document.body.dataset.preferenceAtConnect = document.body.dataset.reference ?? 'unknown';
          }
          if (event.data.sessionId === document.body.dataset.sessionId) {
            if (event.data.type === 'reference-preference') document.body.dataset.reference = String(event.data.enabled);
            if (event.data.type === 'send-context' || event.data.type === 'send-context-error') {
              document.body.dataset.referenceReply = JSON.stringify(event.data);
              document.body.dataset.referenceRequest = event.data.requestId;
            }
          }
          if (event.data.type === 'context' && event.data.sessionId === document.body.dataset.sessionId) {
            if (document.body.dataset.ignoreCaptures) return;
            received.push(event.data.snapshot);
            document.getElementById('received').textContent = JSON.stringify(received);
            if (!document.body.dataset.holdReceipts)
              parent.postMessage({channel:'sim-extension',version:1,type:'context-received',sessionId:event.data.sessionId,snapshotId:event.data.snapshot.id},event.origin);
          }
        });
      </script>
    </body></html>`,
        { headers: { 'content-type': 'text/html' } }
      )
    return new Response(
      `<!doctype html><html><head><title>Private work page</title></head><body>
      <article><h1>Customer escalation</h1><p id="selected">The customer needs a replacement by Friday.</p><p>Reference: visible-reference-482</p></article>
      <input type="password" value="PASSWORD_SENTINEL"/><textarea>TEXTAREA_SENTINEL</textarea>
      <div contenteditable="true" id="editable">EDITABLE_SENTINEL</div><div hidden>HIDDEN_SENTINEL</div>
      <div style="display:none">CSS_HIDDEN_SENTINEL</div><div aria-hidden="true">ARIA_SENTINEL</div>
      <section id="secret-reveal"><p>Credential instructions</p>${secretReveal}<code>visible-code-control</code></section>
      <script>const secret='SCRIPT_SENTINEL'</script>
    </body></html>`,
      { headers: { 'content-type': 'text/html' } }
    )
  },
})
const temporary = await mkdtemp(resolve(tmpdir(), 'sim-extension-e2e-'))
const extensionPath = resolve(temporary, 'extension')
let context: BrowserContext | undefined

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
async function check(name: string, run: () => Promise<void>) {
  const started = performance.now()
  logger.info(`Checking ${name}`)
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) })
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

try {
  await check('The build rejects private key material before creating output', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const rejectedOutput = resolve(temporary, 'rejected-key')
    const result = spawnSync(process.execPath, ['scripts/build.ts', `--outdir=${rejectedOutput}`], {
      cwd: root,
      env: {
        ...process.env,
        SIM_EXTENSION_KEY: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
      },
      encoding: 'utf8',
    })
    assert(result.status !== 0, 'The build accepted private key material')
    assert(
      result.stderr.includes('RSA public key in SPKI format'),
      'The build failed for an unrelated reason'
    )
    assert(!existsSync(rejectedOutput), 'Invalid key material reached build output')
  })
  const origin = `http://127.0.0.1:${fixture.port}`
  const pageOrigin = `http://localhost:${fixture.port}`
  const built = spawnSync(process.execPath, ['scripts/build.ts', `--outdir=${extensionPath}`], {
    cwd: root,
    env: { ...process.env, SIM_EXTENSION_ORIGIN: origin, SIM_EXTENSION_DEV: '1' },
    encoding: 'utf8',
  })
  assert(built.status === 0, `Extension build failed: ${built.stderr}`)
  const manifest = JSON.parse(await readFile(resolve(extensionPath, 'manifest.json'), 'utf8'))
  // Pregrants isolate routing from consent.
  manifest.host_permissions.push(`${pageOrigin}/*`)
  await writeFile(resolve(extensionPath, 'manifest.json'), JSON.stringify(manifest))
  context = await chromium.launchPersistentContext(resolve(temporary, 'profile'), {
    channel: 'chromium',
    headless: true,
    ignoreHTTPSErrors: true,
    args: [
      '--no-proxy-server',
      '--enable-unsafe-extension-debugging',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  })
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  context.setDefaultTimeout(15_000)
  const extensionId = worker.url().split('/')[2]
  const shortHostsVisitedAt = () =>
    worker.evaluate(
      async () => typeof (await chrome.storage.local.get('shortHostsVisitedAt')).shortHostsVisitedAt
    )
  await check('Installing signed out leaves go/ and sim/ as ordinary searches', async () => {
    await expect.poll(() => linksChecks, { timeout: 30_000 }).toBeGreaterThan(0)
    await sleep(2_000)
    assert((await shortHostsVisitedAt()) === 'undefined', 'Visits were recorded while signed out')
    assert(shortHostVisits === 0, 'Short hosts were visited while signed out')
  })
  const signIn = await context.newPage()
  await signIn.goto(`${origin}/sign-in`)
  await signIn.close()
  const panel: Page = await context.newPage()
  // Observe dispatch before the bridge so background metadata queries stay outside each action.
  const observeDispatch = () => {
    window.addEventListener('message', () => {
      document.documentElement.dataset.queryCountAtDispatch =
        document.documentElement.dataset.browserQueryCount ?? '0'
    })
  }
  const panelBundle = resolve(extensionPath, 'sidepanel.js')
  await writeFile(
    panelBundle,
    `(${observeDispatch.toString()})();\n${await readFile(panelBundle, 'utf8')}`
  )
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  await panel.getByTitle('Sim chat').waitFor()
  const frame: Frame = panel.frames()[1] ?? (await panel.waitForEvent('frameattached'))
  const app = panel.frames().find((candidate) => candidate.url().startsWith(origin)) ?? frame
  assert(app, 'Hosted frame did not load')
  await app.waitForSelector('#received')
  await check('A normal-tab HttpOnly session cookie reaches the hosted frame', async () => {
    assert(
      (await app.locator('#session').textContent()) === 'present',
      'Existing session cookie was not sent to the hosted app'
    )
  })
  const page = await context.newPage()
  await page.goto(`${pageOrigin}/ticket?access_token=URL_SECRET#secret`)
  await page.bringToFront()
  let receiverReady = false
  const capture = async (name = 'Attach page') => {
    if (!receiverReady) {
      const intent = await pendingIntent()
      await worker.evaluate(async (intent) => {
        await chrome.storage.session.set({ [`captureIntent:${intent.windowId}:initial`]: intent })
      }, intent)
      return
    }
    await app.evaluate(
      ({ sessionId, action, origin }) => {
        parent.postMessage(
          { channel: 'sim-extension', version: 1, type: 'action', sessionId, action },
          origin
        )
      },
      {
        sessionId: receiverSessionId,
        action: name === 'Selection' ? 'capture-selection' : 'capture-page',
        origin: `chrome-extension://${extensionId}`,
      }
    )
  }
  const snapshots = async () =>
    pageSnapshotSchema.array().parse(JSON.parse(await app.locator('#received').innerText()))
  let receiverSessionId = generateId()
  const post = (message: AppToExtensionMessage) =>
    app.evaluate(({ message, origin }) => parent.postMessage(message, origin), {
      message,
      origin: `chrome-extension://${extensionId}`,
    })
  const setReference = async (enabled: boolean) => {
    await post({
      channel: 'sim-extension',
      version: 1,
      sessionId: receiverSessionId,
      type: 'set-reference-preference',
      enabled,
    })
    await expect(app.locator('body')).toHaveAttribute('data-reference', String(enabled))
  }
  const referenceRequest = () =>
    ({
      channel: 'sim-extension',
      version: 1,
      sessionId: receiverSessionId,
      type: 'capture-for-send',
      requestId: generateId(),
    }) as const
  const readReply = async (requestId: string) => {
    await expect(app.locator('body')).toHaveAttribute('data-reference-request', requestId)
    const raw = await app.locator('body').getAttribute('data-reference-reply')
    assert(raw, 'No reply for the current reference request')
    const reply = extensionToAppMessageSchema.parse(JSON.parse(raw))
    assert(
      (reply.type === 'send-context' || reply.type === 'send-context-error') &&
        reply.requestId === requestId,
      'Unexpected reference reply'
    )
    return reply
  }
  const reference = async () => {
    const message = referenceRequest()
    await post(message)
    return readReply(message.requestId)
  }
  await app.evaluate((sessionId) => {
    document.body.dataset.sessionId = sessionId
  }, receiverSessionId)
  const ready = async () => {
    receiverReady = true
    await app.evaluate(
      ({ targetOrigin, sessionId }) => {
        document.body.dataset.sessionId = sessionId
        delete document.body.dataset.connected
        delete document.body.dataset.reference
        parent.postMessage(
          { channel: 'sim-extension', version: 1, type: 'ready', sessionId },
          targetOrigin
        )
      },
      { targetOrigin: `chrome-extension://${extensionId}`, sessionId: receiverSessionId }
    )
    await expect(app.locator('body')).toHaveAttribute('data-connected', receiverSessionId)
  }
  const pendingIntent = () =>
    worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab.id === undefined || !tab.url) throw new Error('Missing source tab')
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tab.url))
      const urlDigest = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('')
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [0] },
        func: () => null,
      })
      return {
        tabId: tab.id,
        windowId: tab.windowId,
        kind: 'page',
        createdAt: Date.now(),
        documentId: result.documentId,
        urlDigest,
      }
    })

  const settleMessages = async () => {
    const barrierId = generateId()
    await panel.evaluate(
      ({ origin, barrierId }) => {
        const target = document.querySelector('iframe')?.contentWindow
        if (!target) throw new Error('Missing hosted frame')
        target.postMessage({ type: 'e2e-barrier', id: barrierId }, origin)
      },
      { origin, barrierId }
    )
    await app.waitForFunction((id) => document.body.dataset.barrierId === id, barrierId)
  }

  await check(
    'HTTP and HTTPS navigations to the sim and go hosts reach the configured resolver',
    async () => {
      const tab = await page.context().newPage()
      for (const scheme of ['http', 'https']) {
        for (const host of SIM_LINK_HOSTS) {
          for (const path of [
            'handbook',
            'handbook/',
            'jira/123?view=board',
            'jira/a%2Fb?view=board%20view',
          ]) {
            await tab.goto(`${scheme}://${host}/${path}`)
            assert(tab.url() === `${origin}/sim/${path}`, `${host}/${path} reached ${tab.url()}`)
          }
        }
      }
      await tab.close()
    }
  )

  await check(
    'Link drafts enforce the saved URL limit after removing private URL parts',
    async () => {
      const prefix = 'https://links.controls.test/'
      const cases = [
        {
          name: 'A canonical 2048-character destination remains usable',
          input: `${prefix}${'a'.repeat(2048 - prefix.length)}`,
          expected: `${prefix}${'a'.repeat(2048 - prefix.length)}`,
        },
        {
          name: 'A canonical 2049-character destination does not open an unsavable draft',
          input: `${prefix}${'a'.repeat(2049 - prefix.length)}`,
          expected: null,
        },
        {
          name: 'URL serialization cannot expand a short Unicode input beyond the saved limit',
          input: `${prefix}${'é'.repeat(400)}`,
          expected: null,
        },
        {
          name: 'A removable long private query does not reject a short destination',
          input: `${prefix}safe?token=${'s'.repeat(3000)}#private-section`,
          expected: `${prefix}safe`,
        },
      ]
      const failures: string[] = []
      for (const entry of cases) {
        await page.bringToFront()
        const opened = await worker.evaluate(async (linkUrl) => {
          const before = await chrome.tabs.query({})
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
          if (!tab) throw new Error('Missing context-menu source tab')
          const clicked = chrome.contextMenus.onClicked as typeof chrome.contextMenus.onClicked & {
            dispatch: (info: chrome.contextMenus.OnClickData, tab: chrome.tabs.Tab) => void
          }
          clicked.dispatch({ menuItemId: 'create-sim-link', linkUrl, editable: false }, tab)
          const created = (await chrome.tabs.query({})).filter(
            (candidate) => !before.some((existing) => existing.id === candidate.id)
          )
          const urls = created.map((candidate) => candidate.pendingUrl || candidate.url || '')
          for (const candidate of created) {
            if (candidate.id !== undefined) await chrome.tabs.remove(candidate.id)
          }
          return urls
        }, entry.input)
        if (entry.expected === null) {
          if (opened.length !== 0) failures.push(`${entry.name}: opened ${opened.length} draft`)
          continue
        }
        if (opened.length !== 1) {
          failures.push(`${entry.name}: opened ${opened.length} drafts`)
          continue
        }
        const draft = new URL(opened[0])
        if (
          draft.origin !== origin ||
          draft.pathname !== '/extension/create-link' ||
          draft.search !== '' ||
          new URLSearchParams(draft.hash.slice(1)).get('url') !== entry.expected
        )
          failures.push(`${entry.name}: incorrect private-safe destination handoff`)
      }
      assert(failures.length === 0, failures.join('\n'))
      await page.bringToFront()
    }
  )

  await check('Capture stays local until the trusted hosted frame is ready', async () => {
    await capture()
    await panel.getByRole('status').filter({ hasText: 'Attaching the page…' }).waitFor()
    assert((await snapshots()).length === 0, 'Capture crossed before readiness')
    await panel.evaluate(
      (sessionId) =>
        new Promise<void>((resolve) => {
          window.addEventListener('message', function listener(event) {
            if (event.source !== window) return
            window.removeEventListener('message', listener)
            resolve()
          })
          window.postMessage(
            { channel: 'sim-extension', version: 1, type: 'ready', sessionId },
            '*'
          )
        }),
      receiverSessionId
    )
    await settleMessages()
    assert((await snapshots()).length === 0, 'Wrong-origin readiness was accepted')
    const wrongFrameDelivered = panel.evaluate(
      () =>
        new Promise<void>((resolve) => {
          window.addEventListener('message', function listener(event) {
            if (
              event.source === window ||
              event.source === document.querySelector('iframe')?.contentWindow
            )
              return
            window.removeEventListener('message', listener)
            resolve()
          })
        })
    )
    await app.evaluate((sessionId) => {
      const child = document.createElement('iframe')
      child.srcdoc = `<script>top.postMessage({channel:'sim-extension',version:1,type:'ready',sessionId:'${sessionId}'},'*')<\/script>`
      document.body.append(child)
    }, receiverSessionId)
    await wrongFrameDelivered
    await settleMessages()
    assert((await snapshots()).length === 0, 'Wrong-frame readiness was accepted')
    await page.evaluate(() => {
      document.body.textContent = 'SECOND_CAPTURE_SENTINEL'
    })
    await ready()
    await panel.waitForFunction(() => document.querySelector('[role="status"]')?.textContent === '')
    assert(
      !(await snapshots())[0].text.includes('SECOND_CAPTURE_SENTINEL'),
      'A waiting capture was overwritten'
    )
    await page.reload()
  })
  await check(
    'A signed-in panel visits each short host in tabs that close themselves',
    async () => {
      await app.evaluate(
        (targetOrigin) =>
          parent.postMessage(
            { channel: 'sim-extension', version: 1, type: 'signed-in' },
            targetOrigin
          ),
        `chrome-extension://${extensionId}`
      )
      await expect.poll(shortHostsVisitedAt, { timeout: 30_000 }).toBe('number')
      assert(shortHostVisits === SIM_LINK_HOSTS.length, `Visited ${shortHostVisits} short hosts`)
      const leftBehind = await worker.evaluate(
        async (simLinks) => (await chrome.tabs.query({ url: simLinks })).length,
        ['http://go/*', 'http://sim/*', `${origin}/sim/`]
      )
      assert(leftBehind === 0, 'Short host tabs were left open')
    }
  )
  await check(
    'An expired toolbar intent asks for a fresh capture without delivering content',
    async () => {
      const before = (await snapshots()).length
      const intent = { ...(await pendingIntent()), createdAt: Date.now() - 60_000 }
      await worker.evaluate(async (pending) => {
        await chrome.storage.session.set({ [`captureIntent:${pending.windowId}:expired`]: pending })
      }, intent)
      await expect(panel.getByRole('status')).toHaveText(
        'The page attachment expired. Attach it again.'
      )
      assert((await snapshots()).length === before, 'Expired toolbar intent delivered content')
    }
  )
  await check('Page extraction excludes secrets and strips URL query and fragment', async () => {
    const [snapshot] = await snapshots()
    assert(snapshot.text.includes('visible-reference-482'), 'Visible page content missing')
    assert(snapshot.text.includes('visible-code-control'), 'Ordinary code was excluded')
    for (const sentinel of [
      'PASSWORD_SENTINEL',
      'TEXTAREA_SENTINEL',
      'EDITABLE_SENTINEL',
      'HIDDEN_SENTINEL',
      'CSS_HIDDEN_SENTINEL',
      'ARIA_SENTINEL',
      'SCRIPT_SENTINEL',
      'SECRET_REVEAL_SENTINEL',
    ]) {
      assert(!snapshot.text.includes(sentinel), `Captured ${sentinel}`)
    }
    assert(snapshot.url === `${pageOrigin}/ticket`, 'Source URL contains query or fragment')
  })
  await check('A focused read-only custom element attaches only the selected excerpt', async () => {
    await page.evaluate(() => {
      const selected = document.getElementById('selected')
      if (!selected) throw new Error('Missing selection fixture')
      customElements.define('readable-article', class extends HTMLElement {})
      const host = document.createElement('readable-article')
      host.tabIndex = 0
      selected.replaceWith(host)
      host.append(selected)
      host.focus()
      const range = document.createRange()
      range.selectNodeContents(selected)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      if (
        document.activeElement !== host ||
        host.isContentEditable ||
        host.shadowRoot ||
        selection?.toString() !== selected.textContent
      )
        throw new Error('Fixture did not focus and select ordinary custom-element text')
    })
    await capture('Selection')
    await app.waitForFunction(
      () => JSON.parse(document.getElementById('received')?.textContent ?? '[]').length === 2
    )
    const snapshot = (await snapshots())[1]
    assert(
      snapshot.kind === 'selection' &&
        snapshot.text === 'The customer needs a replacement by Friday.',
      'Selection widened beyond the user excerpt'
    )
    await page.locator('readable-article').evaluate((host) => host.replaceWith(...host.childNodes))
  })
  await check('A focused child frame cannot substitute an old parent-page selection', async () => {
    await page.evaluate(() => {
      const frame = document.createElement('iframe')
      frame.srcdoc = '<p>CHILD_SELECTION_SENTINEL</p>'
      document.body.append(frame)
    })
    await page.frameLocator('iframe').getByText('CHILD_SELECTION_SENTINEL').click()
    await page.evaluate(() => {
      const selected = document.getElementById('selected')
      if (!selected) throw new Error('Missing parent selection')
      const range = document.createRange()
      range.selectNodeContents(selected)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
    })
    assert(
      await page.evaluate(() => document.activeElement?.tagName === 'IFRAME'),
      'Fixture did not retain frame focus'
    )
    await capture('Selection')
    await panel.getByRole('status').filter({ hasText: 'could not be read' }).waitFor()
    assert((await snapshots()).length === 2, 'A child-frame gesture captured the parent selection')
    await page.locator('iframe').evaluate((frame) => frame.remove())
  })
  await check('Editable selections fail closed', async () => {
    await page.evaluate(() => {
      const editable = document.getElementById('editable')
      if (!editable) throw new Error('Missing editable fixture')
      const range = document.createRange()
      range.selectNodeContents(editable)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
    })
    await capture('Selection')
    await panel
      .getByRole('status')
      .filter({ hasText: /editable|could not be read/i })
      .waitFor()
    assert((await snapshots()).length === 2, 'Editable content was transmitted')
  })
  await check(
    'A selection inside a closed shadow field cannot become a whole-page reference',
    async () => {
      await setReference(true)
      await page.evaluate(() => {
        const host = document.createElement('div')
        document.body.appendChild(host)
        const field = document.createElement('input')
        field.type = 'password'
        field.value = 'PRIVATE_SHADOW_SENTINEL'
        host.attachShadow({ mode: 'closed' }).append(field)
        field.focus()
        field.select()
      })
      await capture('Selection')
      await expect(panel.getByRole('status')).toContainText('outside an editable or embedded field')
      const refused = await reference()
      assert(
        refused.type === 'send-context-error' && refused.reason === 'selection',
        'A private selection fell back to the surrounding page'
      )
      assert((await snapshots()).length === 2, 'Private selection produced an attachment')
      const next = await page.context().newPage()
      try {
        await next.goto(`${pageOrigin}/after-selection`)
        await next.bringToFront()
        const accepted = await reference()
        assert(
          accepted.type === 'send-context' &&
            accepted.snapshot.url === `${pageOrigin}/after-selection`,
          'The previous failed selection blocked a different tab'
        )
      } finally {
        await next.close()
        await page.bringToFront()
        await setReference(false)
      }
    }
  )
  await check('Large multilingual pages remain bounded and mark truncation', async () => {
    await page.evaluate(() => {
      document.body.textContent = '界'.repeat(200_000)
    })
    await capture()
    await app.waitForFunction(
      () => JSON.parse(document.getElementById('received')?.textContent ?? '[]').length === 3
    )
    const snapshot = (await snapshots())[2]
    assert(snapshot.truncated && snapshot.text.length <= 50_000, 'Large page was not bounded')
    assert(
      new TextEncoder().encode(JSON.stringify(snapshot)).byteLength <= 150_000,
      'Wire byte budget exceeded'
    )
  })
  await check(
    'Snapshots are not persisted and readiness cannot replay acknowledged content',
    async () => {
      const stored = await worker.evaluate(async () => ({
        session: await chrome.storage.session.get(null),
        local: await chrome.storage.local.get(null),
        sync: await chrome.storage.sync.get(null),
      }))
      const serialized = JSON.stringify(stored)
      assert(
        !serialized.includes('visible-reference-482') && !serialized.includes('界'),
        'Snapshot persisted in extension storage'
      )
      await ready()
      assert((await snapshots()).length === 3, 'Acknowledged snapshot replayed')
    }
  )
  await check('A toolbar handoff cannot read a replacement document at the same URL', async () => {
    const intent = await pendingIntent()
    await page.reload()
    await worker.evaluate(async (pending) => {
      await chrome.storage.session.set({
        [`captureIntent:${pending.windowId}:${pending.documentId}`]: pending,
      })
    }, intent)
    await panel
      .getByRole('status')
      .filter({ hasText: /document|frame|changed|cannot|unavailable/i })
      .waitFor()
    assert((await snapshots()).length === 3, 'Stale document handoff captured a new document')
  })
  await check('A toolbar handoff cannot read a new SPA route in the same document', async () => {
    const intent = await pendingIntent()
    await page.evaluate(() => {
      history.pushState({}, '', '/different-resource?secret=NEW_SECRET')
      document.body.textContent = 'SPA_REPLACEMENT_SENTINEL'
    })
    await worker.evaluate(async (pending) => {
      await chrome.storage.session.set({
        [`captureIntent:${pending.windowId}:${pending.documentId}`]: pending,
      })
    }, intent)
    await panel
      .getByRole('status')
      .filter({ hasText: /The page changed/ })
      .waitFor()
    assert((await snapshots()).length === 3, 'Stale URL handoff captured a different SPA route')
  })
  await check('An unrelated page without host access cannot be extracted', async () => {
    await context?.route('https://ungranted.example/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<p>UNGRANTED_SENTINEL</p>' })
    )
    await page.goto('https://ungranted.example/')
    await capture()
    await expect(
      panel.getByRole('button', { name: 'Allow across websites', exact: true })
    ).toBeEnabled()
    assert((await snapshots()).length === 3, 'Unpermitted page was captured')
  })
  await check('Changing the receiving conversation expires an undelivered capture', async () => {
    await page.goto(`${pageOrigin}/ticket`)
    await app.evaluate(() => {
      document.body.dataset.ignoreCaptures = 'true'
    })
    await capture()
    await panel.getByRole('status').filter({ hasText: 'Attaching the page…' }).waitFor()
    const queuedIntent = await pendingIntent()
    await worker.evaluate(async (intent) => {
      await chrome.storage.session.set({ [`captureIntent:${intent.windowId}:queued`]: intent })
    }, queuedIntent)
    receiverSessionId = generateId()
    await app.evaluate(() => {
      delete document.body.dataset.ignoreCaptures
    })
    await ready()
    await expect(panel.getByRole('status')).toHaveText('The chat changed. Attach the page again.')
    await expect
      .poll(() =>
        worker.evaluate(
          async (key) => (await chrome.storage.session.get(key))[key],
          `captureIntent:${queuedIntent.windowId}:queued`
        )
      )
      .toBeUndefined()
    await settleMessages()
    assert((await snapshots()).length === 3, 'A capture crossed into another conversation')
    await capture()
    await app.waitForFunction(
      () => JSON.parse(document.getElementById('received')?.textContent ?? '[]').length === 4
    )
  })
  await check('An old session receipt cannot release the current pending capture', async () => {
    await app.evaluate(() => {
      document.body.dataset.holdReceipts = 'true'
    })
    await capture()
    await app.waitForFunction(
      () => JSON.parse(document.getElementById('received')?.textContent ?? '[]').length === 5
    )
    const snapshotId = (await snapshots())[4].id
    const receipt = (sessionId: string) =>
      app.evaluate(
        ({ targetOrigin, sessionId, snapshotId }) => {
          parent.postMessage(
            {
              channel: 'sim-extension',
              version: 1,
              type: 'context-received',
              sessionId,
              snapshotId,
            },
            targetOrigin
          )
        },
        { targetOrigin: `chrome-extension://${extensionId}`, sessionId, snapshotId }
      )
    await receipt(generateId())
    await capture()
    await panel
      .getByRole('status')
      .filter({ hasText: 'Wait for the page attachment, then try again.' })
      .waitFor()
    assert((await snapshots()).length === 5, 'A stale receipt released the pending capture')
    await receipt(receiverSessionId)
    await panel.waitForFunction(() => document.querySelector('[role="status"]')?.textContent === '')
    await app.evaluate(() => {
      delete document.body.dataset.holdReceipts
    })
  })
  await check('The selection ancestor walk obeys its elapsed-time budget', async () => {
    await page.evaluate(() => {
      const root = document.createElement('div')
      let leaf = root
      for (let depth = 0; depth < 100; depth++) {
        const child = document.createElement('div')
        leaf.append(child)
        leaf = child
      }
      leaf.textContent = 'DEEP_SELECTION_SENTINEL'
      document.body.replaceChildren(root)
      const range = document.createRange()
      if (!leaf.firstChild) throw new Error('Missing selection text')
      range.selectNodeContents(leaf.firstChild)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
    })
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab.id === undefined) throw new Error('Missing fixture tab')
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          let elapsed = 0
          Object.defineProperty(performance, 'now', {
            configurable: true,
            value: () => {
              elapsed += 100
              return elapsed
            },
          })
        },
      })
    })
    await capture('Selection')
    await panel.getByRole('status').filter({ hasText: 'could not be read' }).waitFor()
    assert((await snapshots()).length === 5, 'Unvalidated selection ancestors were traversed')
    await page.reload()
  })
  await check('Unicode and escaped text fit within the complete snapshot budget', async () => {
    await page.goto(`${pageOrigin}/${'a'.repeat(4_000)}`)
    await page.evaluate(() => {
      document.title = '"'.repeat(512)
      document.body.textContent = '界'.repeat(45_000) + '"'.repeat(5_000)
    })
    const before = (await snapshots()).length
    await capture()
    await app.waitForFunction(
      (count) =>
        JSON.parse(document.getElementById('received')?.textContent ?? '[]').length === count,
      before + 1
    )
    const snapshot = pageSnapshotSchema.parse((await snapshots()).at(-1))
    assert(snapshot.truncated, 'Oversized serialized text was not marked partial')
    assert(
      snapshot.text.startsWith('界') && snapshot.text.includes('"'),
      'Capture lost the expected page content'
    )
  })
  await check(
    'Composer capture requests require a current user gesture and conversation',
    async () => {
      await setReference(true)
      const before = (await snapshots()).length
      await panel.evaluate(() => {
        let queries = 0
        let actions = 0
        const originalQuery = chrome.tabs.query.bind(chrome.tabs)
        chrome.tabs.query = ((
          query: chrome.tabs.QueryInfo,
          callback?: (tabs: chrome.tabs.Tab[]) => void
        ) => {
          queries++
          document.documentElement.dataset.browserQueryCount = String(queries)
          return callback ? originalQuery(query, callback) : originalQuery(query)
        }) as typeof chrome.tabs.query
        window.addEventListener('message', (event: MessageEvent<unknown>) => {
          if (
            event.source !== document.querySelector('iframe')?.contentWindow ||
            typeof event.data !== 'object' ||
            event.data === null ||
            !('type' in event.data) ||
            event.data.type !== 'action'
          )
            return
          document.body.dataset.actionQueries = String(
            queries - Number(document.documentElement.dataset.queryCountAtDispatch ?? '0')
          )
          document.body.dataset.observedActions = String(++actions)
        })
      })
      await panel.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true }))
      const parentCdp = await panel.context().newCDPSession(panel)
      const cdp = await panel.context().newCDPSession(app)
      await expect
        .poll(
          async () => {
            const results = await Promise.all(
              [parentCdp, cdp].map((session) =>
                session.send('Runtime.evaluate', {
                  expression: 'navigator.userActivation.isActive',
                  userGesture: false,
                })
              )
            )
            return results.map((result) => result.result.value)
          },
          { timeout: 10_000 }
        )
        .toEqual([false, false])
      const action = {
        channel: 'sim-extension',
        version: 1,
        type: 'action',
        sessionId: receiverSessionId,
        action: 'capture-page',
      }
      await cdp.send('Runtime.evaluate', {
        expression: `parent.postMessage(${JSON.stringify(action)}, ${JSON.stringify(`chrome-extension://${extensionId}`)})`,
        userGesture: false,
      })
      const unactivated = referenceRequest()
      await cdp.send('Runtime.evaluate', {
        expression: `parent.postMessage(${JSON.stringify(unactivated)}, ${JSON.stringify(`chrome-extension://${extensionId}`)})`,
        userGesture: false,
      })
      assert(
        (await readReply(unactivated.requestId)).type === 'send-context-error',
        'Send captured the page without a user gesture'
      )
      await expect
        .poll(async () => {
          const { result } = await parentCdp.send('Runtime.evaluate', {
            expression:
              '[document.body.dataset.observedActions, document.body.dataset.actionQueries]',
            returnByValue: true,
            userGesture: false,
          })
          return result.value
        })
        .toEqual(['1', '0'])
      assert((await snapshots()).length === before, 'Captured without a user gesture')
      await app.evaluate(({ action, targetOrigin }) => parent.postMessage(action, targetOrigin), {
        action: { ...action, sessionId: generateId() },
        targetOrigin: `chrome-extension://${extensionId}`,
      })
      await expect(panel.locator('body')).toHaveAttribute('data-observed-actions', '2')
      await expect(panel.locator('body')).toHaveAttribute('data-action-queries', '0')
      assert((await snapshots()).length === before, 'Captured for an obsolete conversation')
      await capture()
      await app.waitForFunction(
        (count) =>
          JSON.parse(document.getElementById('received')?.textContent ?? '[]').length === count,
        before + 1
      )
      await expect(panel.locator('body')).toHaveAttribute('data-observed-actions', '3')
      assert(
        Number(await panel.locator('body').getAttribute('data-action-queries')) > 0,
        'Allowed capture did not reach the browser API'
      )
      await cdp.detach()
      await parentCdp.detach()
      await setReference(false)
    }
  )
  await check('Ordinary Sim and encoded remote pages attach without sensitive fields', async () => {
    for (const url of [
      `${origin}/workspace/example`,
      `${origin}/extension-notes`,
      `${origin}/workspace/%E2%9C%93`,
      `${pageOrigin}/ticket/100%done`,
    ]) {
      const before = (await snapshots()).length
      await page.goto(`${url}?token=URL_SECRET#FRAGMENT_SECRET`)
      await page.bringToFront()
      await capture()
      await expect.poll(async () => (await snapshots()).length).toBe(before + 1)
      const snapshot = (await snapshots()).at(-1)
      assert(snapshot?.url === url, 'Page URL retained private parameters')
      assert(snapshot.text.includes('visible-reference-482'), 'Visible page content is missing')
      assert(!snapshot.text.includes('SENTINEL'), 'Sensitive page content was captured')
    }
  })
  await check('Embedded chat and malformed Sim paths fail closed', async () => {
    for (const path of [
      '/extension',
      '/extension/workspace',
      '/extension/o/organization',
      '/%65xtension',
      '/%65xtension/workspace',
      '/extension%2fworkspace',
      '/extension%ZZ/workspace',
    ]) {
      await page.goto(`${origin}/workspace/example`)
      await page.bringToFront()
      const previous = (await snapshots()).length
      await capture()
      await expect.poll(async () => (await snapshots()).length).toBe(previous + 1)
      await expect(panel.getByRole('status')).toHaveText('')
      const before = (await snapshots()).length
      await page.goto(`${origin}${path}`)
      await page.bringToFront()
      await capture()
      await panel.getByRole('status').filter({ hasText: 'This page cannot be attached.' }).waitFor()
      assert((await snapshots()).length === before, 'An excluded Sim path was captured')
    }
  })
  await check(
    'Revealed credentials stay excluded from exact and surrounding selections',
    async () => {
      await page.goto(`${origin}/workspace/example`)
      await page.bringToFront()
      const before = (await snapshots()).length
      await capture()
      await expect.poll(async () => (await snapshots()).length).toBe(before + 1)
      await expect(panel.getByRole('status')).toHaveText('')
      await page
        .locator('#secret-reveal code')
        .first()
        .evaluate((element) => {
          const range = document.createRange()
          range.selectNodeContents(element)
          window.getSelection()?.removeAllRanges()
          window.getSelection()?.addRange(range)
        })
      await capture('Selection')
      await expect(panel.getByRole('status')).toContainText('could not be read')
      assert((await snapshots()).length === before + 1, 'A revealed credential was attached')
      await page.locator('#secret-reveal').evaluate((element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        window.getSelection()?.removeAllRanges()
        window.getSelection()?.addRange(range)
      })
      await capture('Selection')
      await expect.poll(async () => (await snapshots()).length).toBe(before + 2)
      const snapshot = (await snapshots()).at(-1)
      assert(snapshot, 'Missing surrounding selection snapshot')
      assert(snapshot.text.includes('Credential instructions'), 'Public selection text is missing')
      assert(snapshot.text.includes('visible-code-control'), 'Ordinary selected code was excluded')
      assert(
        !snapshot.text.includes('SECRET_REVEAL_SENTINEL'),
        'A surrounding selection leaked the credential'
      )
    }
  )
  await check(
    'Site access stays modal without violating the packaged security policy',
    async () => {
      const policyErrors: string[] = []
      panel.on('console', (message) => {
        if (message.type() === 'error' && message.text().includes('Content Security Policy'))
          policyErrors.push(message.text())
      })
      const openAccess = () =>
        app.evaluate(
          ({ targetOrigin, sessionId }) => {
            parent.postMessage(
              {
                channel: 'sim-extension',
                version: 1,
                type: 'action',
                sessionId,
                action: 'site-access',
              },
              targetOrigin
            )
          },
          { targetOrigin: `chrome-extension://${extensionId}`, sessionId: receiverSessionId }
        )
      await panel.bringToFront()
      await openAccess()
      const dialog = panel.getByRole('dialog', { name: 'Page access' })
      await expect(dialog).toBeVisible()
      await settleMessages()
      assert(policyErrors.length === 0, `Site access violated CSP: ${policyErrors.join('\n')}`)
      await panel.evaluate(() => document.querySelector('iframe')?.focus())
      assert(
        await dialog.evaluate((element) => element.contains(document.activeElement)),
        'The hosted frame accepted focus behind the modal'
      )
      await dialog.getByRole('button', { name: 'Close' }).press('Escape')
      await expect(dialog, 'Escape closes the modal').toBeHidden()
      await openAccess()
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Close' }).click()
      await expect(dialog, 'The Close button dismisses the modal').toBeHidden()
      await openAccess()
      await expect(dialog).toBeVisible()
      await dialog.click({ trial: true })
      await panel.mouse.click(1, 1)
      await expect(dialog, 'The backdrop dismisses the modal').toBeHidden()
      assert(policyErrors.length === 0, `Site access violated CSP: ${policyErrors.join('\n')}`)
    }
  )
  await check(
    'Only the latest conversation connects, after receiving the saved reference preference',
    async () => {
      await setReference(true)
      await panel.evaluate(() => {
        const original = chrome.storage.local.get.bind(chrome.storage.local)
        chrome.storage.local.get = (async (keys: string) => {
          chrome.storage.local.get = original
          const result = await original(keys)
          document.body.dataset.preferenceRead = 'held'
          await new Promise<void>((resolve) =>
            document.addEventListener('release-preference', () => resolve(), { once: true })
          )
          document.body.dataset.preferenceRead = 'finished'
          return result
        }) as typeof chrome.storage.local.get
      })
      await app.evaluate(
        ({ origin, sessionId }) => {
          delete document.body.dataset.reference
          delete document.body.dataset.connected
          document.body.dataset.sessionId = sessionId
          parent.postMessage(
            { channel: 'sim-extension', version: 1, type: 'ready', sessionId },
            origin
          )
        },
        { origin: `chrome-extension://${extensionId}`, sessionId: generateId() }
      )
      await expect(panel.locator('body')).toHaveAttribute('data-preference-read', 'held')
      await settleMessages()
      assert(
        (await app.locator('body').getAttribute('data-connected')) === null,
        'Shell connected before its preference was known'
      )
      receiverSessionId = generateId()
      await ready()
      await expect(app.locator('body')).toHaveAttribute('data-preference-at-connect', 'true')
      await panel.evaluate(() => document.dispatchEvent(new Event('release-preference')))
      await expect(panel.locator('body')).toHaveAttribute('data-preference-read', 'finished')
      await settleMessages()
      await expect(app.locator('body')).toHaveAttribute('data-connected', receiverSessionId)
      await setReference(false)
    }
  )
  await check('A failed preference read keeps manual attachment available', async () => {
    await panel.evaluate(() => {
      const get = chrome.storage.local.get.bind(chrome.storage.local)
      chrome.storage.local.get = (() => {
        chrome.storage.local.get = get
        return Promise.reject(new Error('Storage unavailable'))
      }) as typeof chrome.storage.local.get
    })
    receiverSessionId = generateId()
    await ready()
    await expect(app.locator('body')).toHaveAttribute('data-connected', receiverSessionId)
    await expect(app.locator('body')).toHaveAttribute('data-preference-at-connect', 'false')
    await expect(panel.getByRole('status')).toContainText('Attach the page manually')
    const before = (await snapshots()).length
    await page.goto(`${origin}/workspace/example`)
    await page.bringToFront()
    await capture()
    await expect.poll(async () => (await snapshots()).length).toBe(before + 1)
  })
  await check(
    'Toolbar access on a new site allows an explicit retry without pinning it in Reference mode',
    async () => {
      const browser = page.context().browser()
      assert(browser, 'Missing Chromium browser')
      const cdp = await browser.newBrowserCDPSession()
      try {
        await setReference(true)
        await page
          .context()
          .route('https://reference-source.example/**', (route) =>
            route.fulfill({ contentType: 'text/html', body: '<p>NEW_REFERENCE_SOURCE</p>' })
          )
        await page.goto('https://reference-source.example/new-source?token=PRIVATE#fragment')
        await page.bringToFront()
        assert((await reference()).type === 'send-context-error', 'An ungranted site was captured')
        await panel.evaluate(() => {
          let intents = 0
          document.body.dataset.toolbarIntents = '0'
          chrome.storage.onChanged.addListener((changes, area) => {
            if (
              area === 'session' &&
              Object.entries(changes).some(
                ([key, change]) => key.startsWith('captureIntent:') && change.newValue
              )
            )
              document.body.dataset.toolbarIntents = String(++intents)
          })
        })
        const targets = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] })
        const target = targets.targetInfos.find((item) => item.url === page.url())
        assert(target, 'Missing toolbar action target')
        const action = { id: extensionId, targetId: target.targetId }
        await cdp.send('Extensions.triggerAction', action)
        const retried = await reference()
        assert(
          retried.type === 'send-context' && retried.snapshot.text.includes('NEW_REFERENCE_SOURCE'),
          'Toolbar access did not allow the explicit retry'
        )
        assert(
          retried.snapshot.url === 'https://reference-source.example/new-source',
          'Reference retained a private URL parameter'
        )
        await expect(panel.locator('body')).toHaveAttribute('data-toolbar-intents', '0')
        await setReference(false)
        await cdp.send('Extensions.triggerAction', action)
        await expect(panel.locator('body')).toHaveAttribute('data-toolbar-intents', '1')
      } finally {
        await cdp.detach()
        await page.context().unroute('https://reference-source.example/**')
      }
    }
  )
  await check(
    'Switching away and back during extraction discards the send-time reference',
    async () => {
      await setReference(true)
      await page.goto(`${pageOrigin}/switch-source`)
      await page.bringToFront()
      await panel.evaluate(() => {
        const original = chrome.scripting.executeScript.bind(chrome.scripting)
        // Hold the real Chrome result while the source changes, even on a fast runner.
        chrome.scripting.executeScript = (async (
          injection: chrome.scripting.ScriptInjection<unknown[], unknown>
        ) => {
          chrome.scripting.executeScript = original
          const result = await original(injection)
          document.body.dataset.extraction = 'complete'
          await new Promise<void>((resolve) =>
            document.addEventListener('release-extraction', () => resolve(), { once: true })
          )
          return result
        }) as typeof chrome.scripting.executeScript
      })
      const pending = reference()
      await expect(panel.locator('body')).toHaveAttribute('data-extraction', 'complete')
      const alternate = await page.context().newPage()
      try {
        await alternate.goto(`${pageOrigin}/alternate`)
        await alternate.bringToFront()
        await page.bringToFront()
      } finally {
        await alternate.close()
        await panel.evaluate(() => document.dispatchEvent(new Event('release-extraction')))
      }
      const reply = await pending
      assert(
        reply.type === 'send-context-error' && reply.message.includes('changed'),
        'Returning to the same tab released stale page content'
      )
      await setReference(false)
    }
  )
  await check(
    'Stale capture intents cannot interrupt an explicit send-time reference',
    async () => {
      await page.goto(`${pageOrigin}/stale-intent-source`)
      await page.bringToFront()
      for (const stale of ['expired', 'previous-session', 'other-window', 'future'] as const) {
        const intent = await pendingIntent()
        const sourceWindowId = intent.windowId
        if (stale === 'expired') intent.createdAt -= 31_000
        else if (stale === 'future') intent.createdAt += 60_000
        else if (stale === 'other-window') intent.windowId++
        else {
          receiverSessionId = generateId()
          await ready()
        }
        await setReference(true)
        const before = (await snapshots()).length
        const key = `captureIntent:${sourceWindowId}:${stale}`
        await panel.evaluate((key) => {
          const original = chrome.scripting.executeScript.bind(chrome.scripting)
          document.body.dataset.extraction = 'pending'
          delete document.body.dataset.staleIntent
          const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
            if (area !== 'session' || !changes[key]?.newValue) return
            chrome.storage.onChanged.removeListener(changed)
            document.body.dataset.staleIntent = key
          }
          chrome.storage.onChanged.addListener(changed)
          chrome.scripting.executeScript = (async (
            injection: chrome.scripting.ScriptInjection<unknown[], unknown>
          ) => {
            chrome.scripting.executeScript = original
            const result = await original(injection)
            document.body.dataset.extraction = 'complete'
            await new Promise<void>((resolve) =>
              document.addEventListener('release-extraction', () => resolve(), { once: true })
            )
            return result
          }) as typeof chrome.scripting.executeScript
        }, key)
        const pending = reference()
        try {
          await expect(panel.locator('body')).toHaveAttribute('data-extraction', 'complete')
          await worker.evaluate(
            ({ key, intent }) => chrome.storage.session.set({ [key]: intent }),
            {
              key,
              intent,
            }
          )
          await expect(panel.locator('body')).toHaveAttribute('data-stale-intent', key)
        } finally {
          await panel.evaluate(() => document.dispatchEvent(new Event('release-extraction')))
        }
        const reply = await pending
        assert(
          reply.type === 'send-context' && reply.snapshot.text.includes('visible-reference-482'),
          `${stale} intent cancelled the current reference: ${reply.type}`
        )
        const replayKey = `${key}:idle-replay`
        const keys = [key, replayKey]
        // A fresh storage event drains deferred intents without depending on the periodic sweep's phase.
        await worker.evaluate(({ key, intent }) => chrome.storage.session.set({ [key]: intent }), {
          key: replayKey,
          intent,
        })
        await expect
          .poll(
            () =>
              worker.evaluate(async (keys) => {
                const stored = await chrome.storage.session.get(keys)
                return keys.every((key) => !(key in stored))
              }, keys),
            { message: `${stale}: idle storage delivery drains deferred stale intents` }
          )
          .toBe(true)
        await settleMessages()
        assert((await snapshots()).length === before, `${stale} intent attached a manual page`)
        await setReference(false)
      }
    }
  )
  await check(
    'Page access asks the browser for website access without reading before approval',
    async () => {
      const source = 'https://private-source.example'
      const privateUrl = `${source}/sensitive-path?token=PRIVATE_URL_SENTINEL#fragment`
      await page
        .context()
        .route(`${source}/**`, (route) =>
          route.fulfill({ contentType: 'text/html', body: '<p>PRIVATE_CONTENT_SENTINEL</p>' })
        )
      await page.goto(privateUrl)
      await page.bringToFront()
      await setReference(true)
      const before = (await snapshots()).length
      const denied = await reference()
      assert(denied.type === 'send-context-error', 'Reference read the private site without access')
      assert(
        !denied.message.includes('private-source') && !denied.message.includes('PRIVATE'),
        'Access failure exposed the private URL'
      )
      await panel.evaluate(() => {
        const requests: chrome.permissions.Permissions[] = []
        const request = chrome.permissions.request.bind(chrome.permissions)
        chrome.permissions.request = ((permissions: chrome.permissions.Permissions) => {
          requests.push(permissions)
          document.body.dataset.requestedAccess = JSON.stringify(requests)
          document.body.dataset.requestGesture = String(navigator.userActivation.isActive)
          return request(permissions)
        }) as typeof chrome.permissions.request
        const execute = chrome.scripting.executeScript.bind(chrome.scripting)
        chrome.scripting.executeScript = ((...args: Parameters<typeof execute>) => {
          document.body.dataset.unrequestedRead = 'true'
          return execute(...args)
        }) as typeof chrome.scripting.executeScript
      })
      const allow = panel.getByRole('button', { name: 'Allow across websites', exact: true })
      await expect(allow).toBeEnabled()
      assert(
        (await panel.locator('body').getAttribute('data-requested-access')) === null,
        'A failed capture initiated a permission request without an explicit action'
      )
      const grantedSites = () =>
        worker.evaluate(async () => ((await chrome.permissions.getAll()).origins ?? []).sort())
      const previousAccess = await grantedSites()
      await allow.click()
      await expect(panel.locator('body')).toHaveAttribute('data-request-gesture', 'true')
      const requested = await panel.locator('body').getAttribute('data-requested-access')
      assert(requested, 'The user action never reached Chrome')
      expect(JSON.parse(requested)).toEqual([{ origins: ['https://*/*', 'http://*/*'] }])
      expect(await grantedSites(), 'A site received persistent access without approval').toEqual(
        previousAccess
      )
      await settleMessages()
      assert(
        (await panel.locator('body').getAttribute('data-unrequested-read')) === null,
        'Managing site access attempted to read page content'
      )
      assert((await snapshots()).length === before, 'Managing site access attached a page')
      await expect(app.locator('body')).toHaveAttribute('data-reference-request', denied.requestId)
    }
  )
  await mkdir(dirname(output), { recursive: true })
  await panel.screenshot({ path: output.replace(/\.json$/, '.png'), fullPage: true })
} catch (error) {
  if (!checks.some((entry) => entry.status === 'failed'))
    checks.push({
      name: 'Suite setup',
      status: 'failed',
      durationMs: 0,
      error: getErrorMessage(error),
    })
  process.exitCode = 1
} finally {
  await context?.close()
  fixture.stop(true)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify({ suite: 'browser-extension', checks }, null, 2))
  await rm(temporary, { recursive: true, force: true })
}
