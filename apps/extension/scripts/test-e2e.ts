import { spawnSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type BrowserContext, chromium, expect, type Frame, type Page } from '@playwright/test'
import { pageSnapshotSchema } from '@sim/browser-extension-protocol'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const logger = createLogger('BrowserExtensionE2E')
const reportPath = process.env.EXTENSION_REPORT_PATH
if (!reportPath) throw new Error('Set EXTENSION_REPORT_PATH to the output JSON report path.')
const output = resolve(root, reportPath)
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const fixture = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/sign-in')
      return new Response('Fixture session created', {
        headers: { 'set-cookie': 'fixture-session=present; Path=/; HttpOnly; SameSite=Lax' },
      })
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
  // The test package pregrants its disposable fixture site, equivalent to an accepted site prompt.
  manifest.host_permissions.push(`${pageOrigin}/*`)
  await writeFile(resolve(extensionPath, 'manifest.json'), JSON.stringify(manifest))
  context = await chromium.launchPersistentContext(resolve(temporary, 'profile'), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  })
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  context.setDefaultTimeout(15_000)
  const extensionId = worker.url().split('/')[2]
  const signIn = await context.newPage()
  await signIn.goto(`${origin}/sign-in`)
  await signIn.close()
  const panel: Page = await context.newPage()
  // Observe dispatch before the bridge so background metadata queries stay outside each action.
  await panel.addInitScript(() => {
    window.addEventListener('message', () => {
      document.documentElement.dataset.queryCountAtDispatch =
        document.documentElement.dataset.browserQueryCount ?? '0'
    })
  })
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
  await app.evaluate((sessionId) => {
    document.body.dataset.sessionId = sessionId
  }, receiverSessionId)
  const ready = () => {
    receiverReady = true
    return app.evaluate(
      ({ targetOrigin, sessionId }) => {
        document.body.dataset.sessionId = sessionId
        parent.postMessage(
          { channel: 'sim-extension', version: 1, type: 'ready', sessionId },
          targetOrigin
        )
      },
      { targetOrigin: `chrome-extension://${extensionId}`, sessionId: receiverSessionId }
    )
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

  await check('Capture stays local until the trusted hosted frame is ready', async () => {
    await capture()
    await panel.getByRole('status').filter({ hasText: 'Waiting for Sim' }).waitFor()
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
    'An expired toolbar intent asks for a fresh capture without delivering content',
    async () => {
      const before = (await snapshots()).length
      const intent = { ...(await pendingIntent()), createdAt: Date.now() - 60_000 }
      await worker.evaluate(async (pending) => {
        await chrome.storage.session.set({ [`captureIntent:${pending.windowId}:expired`]: pending })
      }, intent)
      await expect(panel.getByRole('status')).toHaveText(
        'The capture expired. Attach the page again.'
      )
      assert((await snapshots()).length === before, 'Expired toolbar intent delivered content')
    }
  )
  await check('Page extraction excludes secrets and strips URL query and fragment', async () => {
    const [snapshot] = await snapshots()
    assert(snapshot.text.includes('visible-reference-482'), 'Visible page content missing')
    for (const sentinel of [
      'PASSWORD_SENTINEL',
      'TEXTAREA_SENTINEL',
      'EDITABLE_SENTINEL',
      'HIDDEN_SENTINEL',
      'CSS_HIDDEN_SENTINEL',
      'ARIA_SENTINEL',
      'SCRIPT_SENTINEL',
    ]) {
      assert(!snapshot.text.includes(sentinel), `Captured ${sentinel}`)
    }
    assert(snapshot.url === `${pageOrigin}/ticket`, 'Source URL contains query or fragment')
  })
  await check('Selection attaches only the selected excerpt', async () => {
    await page.evaluate(() => {
      const selected = document.getElementById('selected')
      if (!selected) throw new Error('Missing selection fixture')
      const range = document.createRange()
      range.selectNodeContents(selected)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
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
      .filter({ hasText: /document|frame|changed|cannot/i })
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
      .filter({ hasText: /changed before reading/i })
      .waitFor()
    assert((await snapshots()).length === 3, 'Stale URL handoff captured a different SPA route')
  })
  await check('An unrelated page without host access cannot be extracted', async () => {
    await context?.route('https://ungranted.example/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<p>UNGRANTED_SENTINEL</p>' })
    )
    await page.goto('https://ungranted.example/')
    await capture()
    await panel
      .getByRole('status')
      .filter({ hasText: /access|permission|cannot/i })
      .waitFor()
    assert((await snapshots()).length === 3, 'Unpermitted page was captured')
  })
  await check('Changing the receiving conversation expires an undelivered capture', async () => {
    await page.goto(`${pageOrigin}/ticket`)
    await app.evaluate(() => {
      document.body.dataset.ignoreCaptures = 'true'
    })
    await capture()
    await panel.getByRole('status').filter({ hasText: 'Waiting for Sim' }).waitFor()
    const queuedIntent = await pendingIntent()
    await worker.evaluate(async (intent) => {
      await chrome.storage.session.set({ [`captureIntent:${intent.windowId}:queued`]: intent })
    }, queuedIntent)
    receiverSessionId = generateId()
    await app.evaluate(() => {
      delete document.body.dataset.ignoreCaptures
    })
    await ready()
    await panel
      .getByRole('status')
      .filter({ hasText: /conversation changed|previous conversation was discarded/ })
      .waitFor()
    await panel
      .getByRole('status')
      .filter({ hasText: /previous conversation was discarded/ })
      .waitFor()
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
    await panel.getByRole('status').filter({ hasText: 'previous capture' }).waitFor()
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
      await expect(panel.locator('body')).toHaveAttribute('data-observed-actions', '1')
      await expect(panel.locator('body')).toHaveAttribute('data-action-queries', '0')
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
      const dialog = panel.getByRole('dialog', { name: 'Site access' })
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
