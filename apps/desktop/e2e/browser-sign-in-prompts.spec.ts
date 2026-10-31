import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type ElectronApplication, _electron as electron, expect, test } from '@playwright/test'
import type {
  BrowserAppLaunchNotice,
  BrowserPagePrompt,
  BrowserToolName,
} from '@sim/browser-protocol'
import type { SimDesktopApi } from '@sim/desktop-bridge'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { build } from 'esbuild'
import postcss from 'postcss'
import loadPostcssConfig from 'postcss-load-config'

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))
const SCOPE = 'browser-sign-in-prompts-e2e'
const SIM_DIR = fileURLToPath(new URL('../../sim/', import.meta.url))
const SHELL_FIXTURE =
  '<!doctype html><title>Sim fixture</title><link rel="stylesheet" href="/fixture.css"><h1>Browser sign-in fixture</h1><div id="root"></div><div id="native-panel" style="position:absolute;top:120px;bottom:0;left:0;right:0"></div><script src="/fixture.js"></script>'
const CREDENTIALS = `Basic ${Buffer.from('alice:s3cret').toString('base64')}`
/** Long enough for a refused request to have surfaced if it were going to. */
const QUIET_MS = 1_500

type Bridge = typeof globalThis & {
  simDesktop: SimDesktopApi
  pagePrompt?: BrowserPagePrompt | null
  launchNotice?: BrowserAppLaunchNotice | null
  boundsTimer?: number
}

type MainGlobals = typeof globalThis & { openedExternal?: string[] }

/**
 * A browser tab's sign-in challenges and links to other apps belong to the
 * user: Sim shows the question for the tab that asked, only a click in Sim
 * answers it, and nothing is asked of an older renderer that cannot show it.
 * These checks drive the real shell, native tab views, and Sim's prompt UI.
 */
test('sign-in and app-launch prompts wait for the user on the page that asked', async () => {
  test.setTimeout(180_000)
  const reportPath =
    process.env.DESKTOP_BROWSER_SIGNIN_REPORT_PATH ??
    test.info().outputPath('browser-sign-in-prompts.json')
  const checks: {
    name: string
    status: 'passed' | 'failed'
    durationMs: number
    error?: string
  }[] = []
  const check = async (name: string, run: () => Promise<void>) => {
    const started = Date.now()
    try {
      await test.step(name, run)
      checks.push({ name, status: 'passed', durationMs: Date.now() - started })
    } catch (error) {
      checks.push({
        name,
        status: 'failed',
        durationMs: Date.now() - started,
        error: getErrorMessage(error),
      })
      throw error
    }
  }
  const browserComponents = join(
    SIM_DIR,
    'app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session'
  )
  const bundle = await build({
    stdin: {
      contents: `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useBrowserSessionStore as store } from ${JSON.stringify(join(SIM_DIR, 'stores/browser-session/store.ts'))};
import { BrowserAppLaunchNoticeBar, BrowserPagePromptModal } from ${JSON.stringify(join(browserComponents, 'browser-page-prompt.tsx'))};
import { useBrowserPanelOcclusion } from ${JSON.stringify(join(browserComponents, 'browser-panel-occlusion.ts'))};
const scope = ${JSON.stringify(SCOPE)};
const api = globalThis.simDesktop.browserAgent;
api.onPageState(state => store.getState().setPageState(state));
store.subscribe(state => {
  globalThis.pagePrompt = state.sessions[scope]?.pageState?.prompt ?? null;
  globalThis.launchNotice = state.sessions[scope]?.pageState?.appLaunchNotice ?? null;
});
function Fixture() {
  const page = store(state => state.sessions[scope]?.pageState);
  useBrowserPanelOcclusion(scope, page?.tabId ?? null, true, () => document.getElementById('native-panel')?.getBoundingClientRect() ?? null);
  const respond = (requestId, response) => api.panelAction({ action: 'respond-prompt', requestId, response }, scope);
  return createElement('div', null,
    page?.appLaunchNotice ? createElement(BrowserAppLaunchNoticeBar, { key: page.appLaunchNotice.requestId, notice: page.appLaunchNotice, onRespond: respond }) : null,
    createElement(BrowserPagePromptModal, { prompt: page?.prompt, open: Boolean(page?.prompt), onRespond: respond }));
}
createRoot(document.getElementById('root')).render(createElement(Fixture));`,
      resolveDir: SIM_DIR,
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    outfile: test.info().outputPath('fixture.js'),
    external: ['node:async_hooks'],
    banner: { js: 'var process={env:{NODE_ENV:"development"},browser:true};' },
    format: 'iife',
    platform: 'browser',
    tsconfig: join(SIM_DIR, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"development"' },
  })
  const config = await loadPostcssConfig({}, SIM_DIR)
  const stylesheet = join(SIM_DIR, 'app/_styles/globals.css')
  const css = await postcss(config.plugins).process(readFileSync(stylesheet, 'utf8'), {
    from: stylesheet,
  })
  const calls = new Map<string, { chatId: string; toolName: BrowserToolName; args: unknown }>()
  const challenges: string[] = []
  let otherPort = 0
  const handleSite = (request: IncomingMessage, response: ServerResponse, port: number) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    if (path === '/basic') {
      challenges.push(`${port}${path}`)
      if (request.headers.authorization === CREDENTIALS) {
        response.writeHead(200, { 'Content-Type': 'text/html' })
        response.end('<!doctype html><title>secret</title>')
        return
      }
      response.writeHead(401, {
        'Content-Type': 'text/html',
        'WWW-Authenticate': 'Basic realm="Fixture realm"',
      })
      response.end('<!doctype html><title>denied</title>')
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/html' })
    if (path === '/subresource') {
      response.end(
        `<!doctype html><title>sub</title><img src="http://localhost:${otherPort}/basic" onerror="document.title='img-failed'" onload="document.title='img-loaded'">`
      )
      return
    }
    if (path === '/links') {
      response.end(`<!doctype html><title>links</title>
<p><a id="app" href="simfixture://join?id=7">Join meeting</a></p>
<p><a id="denied" href="ms-msdt:id">Diagnostics</a></p>
<p><a id="unhandled" href="nohandler://x">Unhandled</a></p>
<p><a id="mail" href="mailto:a@example.com?subject=Hi">Mail</a></p>
`)
      return
    }
    if (path === '/auto') {
      response.end(
        `<!doctype html><title>auto</title><script>location.href = 'simfixture://auto'</script>`
      )
      return
    }
    response.end('<!doctype html><title>next</title>')
  }
  const server: Server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    if (path === '/fixture.js' || path === '/fixture.css') {
      response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css')
      response.end(
        path.endsWith('.js')
          ? bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.text
          : css.css
      )
      return
    }
    if (path === '/api/desktop/tool/authorize') {
      let body = ''
      for await (const chunk of request) body += chunk.toString()
      const authorization = calls.get(JSON.parse(body).toolCallId)
      response.writeHead(authorization ? 200 : 403, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(authorization ?? {}))
      return
    }
    // The app origin serves the shell; the same server on localhost is the web.
    if (request.headers.host?.startsWith('localhost')) {
      const address = server.address()
      handleSite(request, response, typeof address === 'object' && address ? address.port : 0)
      return
    }
    response.writeHead(200, {
      'Content-Type': 'text/html',
      'Set-Cookie': 'better-auth.session_token=fixture; HttpOnly; Path=/',
    })
    response.end(SHELL_FIXTURE)
  })
  const otherSite: Server = createServer((request, response) =>
    handleSite(request, response, otherPort)
  )
  const userData = mkdtempSync(join(tmpdir(), 'sim-browser-signin-e2e-'))
  let app: ElectronApplication | undefined
  let passed = false
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    await new Promise<void>((resolve) => otherSite.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const otherAddress = otherSite.address()
    if (
      !address ||
      typeof address === 'string' ||
      !otherAddress ||
      typeof otherAddress === 'string'
    )
      throw new Error('Missing fixture address')
    otherPort = otherAddress.port
    const origin = `http://127.0.0.1:${address.port}`
    const site = `http://localhost:${address.port}`
    const crossSite = `http://localhost:${otherPort}`
    const shellApp = await electron.launch({
      args: [process.env.SIM_DESKTOP_E2E_MAIN ?? '.'],
      cwd: DESKTOP_DIR,
      env: { ...process.env, SIM_DESKTOP_ORIGIN: origin, SIM_DESKTOP_USER_DATA: userData },
    })
    app = shellApp
    // Launching real apps is out of scope: record what the shell would hand the OS,
    // and register a fixture handler for the schemes the page links to.
    await shellApp.evaluate(({ app, shell }) => {
      const main = globalThis as MainGlobals
      main.openedExternal = []
      shell.openExternal = async (url: string) => {
        main.openedExternal?.push(url)
      }
      app.getApplicationNameForProtocol = (url: string) =>
        /^(simfixture|ms-msdt|mailto):/i.test(url) ? 'Fixture Meetings' : ''
    })
    const openedExternal = () =>
      shellApp.evaluate(() => [...((globalThis as MainGlobals).openedExternal ?? [])])
    const shell = await shellApp.firstWindow()
    await shellApp.evaluate(({ app, BrowserWindow }) => {
      const host = BrowserWindow.getAllWindows()[0]
      if (!host) throw new Error('Missing host window')
      app.focus({ steal: true })
      host.focus()
    })
    await expect(shell.getByRole('heading')).toHaveText('Browser sign-in fixture')
    await shell.evaluate(async (scope) => {
      const bridge = globalThis as Bridge
      const api = bridge.simDesktop.browserAgent
      await api.activateScope(scope)
      const updateBounds = () =>
        api.setPanelBounds(
          { x: 0, y: 120, width: innerWidth, height: innerHeight - 120 },
          null,
          scope
        )
      updateBounds()
      bridge.boundsTimer = window.setInterval(updateBounds, 200)
    }, SCOPE)

    let callCount = 0
    const startTool = (tool: BrowserToolName, args: Record<string, unknown>) => {
      const callId = `browser-signin-${++callCount}`
      calls.set(callId, { chatId: SCOPE, toolName: tool, args })
      return shell.evaluate(
        ({ callId, tool, args, scope }) =>
          (globalThis as Bridge).simDesktop.browserAgent.executeTool(callId, tool, args, scope),
        { callId, tool, args, scope: SCOPE }
      )
    }
    const execute = async (tool: BrowserToolName, args: Record<string, unknown>) => {
      const result = await startTool(tool, args)
      expect(result.ok, result.error).toBe(true)
      return result.result
    }
    /** Browser-chrome actions are user gestures, so each follows a real click in Sim. */
    const panelAction = async (action: Record<string, unknown>) => {
      await shell.getByRole('heading').click()
      await shell.evaluate(
        ({ action, scope }) =>
          (globalThis as Bridge).simDesktop.browserAgent.panelAction(
            action as unknown as Parameters<SimDesktopApi['browserAgent']['panelAction']>[0],
            scope
          ),
        { action, scope: SCOPE }
      )
    }
    const pagePrompt = () => shell.evaluate(() => (globalThis as Bridge).pagePrompt ?? null)
    const launchNotice = () => shell.evaluate(() => (globalThis as Bridge).launchNotice ?? null)
    /** The page currently at `url`; `read` is `title` or a script evaluated in it. */
    const pageAt = <T>(url: string, read: string) =>
      shellApp.evaluate(
        async ({ webContents }, { url, read }) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) => !candidate.isDestroyed() && candidate.getURL() === url)
          if (!contents) return null
          if (read === 'title') return contents.getTitle() as T
          return (await contents.executeJavaScript(read, true)) as T
        },
        { url, read }
      )
    const titleAt = (url: string) => () => pageAt<string>(url, 'title')
    const navigate = async (url: string) => {
      await panelAction({ action: 'navigate', url })
      await expect.poll(() => pageAt<string>(url, 'title')).not.toBeNull()
    }
    /** Trusted input into the page, the way the user's own click arrives and focuses it. */
    const userClick = (url: string, selector: string) =>
      shellApp.evaluate(
        async ({ webContents }, { url, selector }) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) => !candidate.isDestroyed() && candidate.getURL() === url)
          if (!contents) throw new Error(`No page at ${url}`)
          const rect: { x: number; y: number } = await contents.executeJavaScript(
            `(() => { const { x, y } = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x, y } })()`
          )
          const point = { x: Math.round(rect.x + 3), y: Math.round(rect.y + 3) }
          contents.focus()
          contents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
          contents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
        },
        { url, selector }
      )
    /** Types into the visible sign-in prompt the way the user does: the password field unlocks on focus. */
    const signInAs = async (username: string, password: string) => {
      const dialog = shell.getByRole('dialog')
      await expect(dialog).toHaveCount(1)
      await expect(async () => {
        await dialog.getByRole('textbox', { name: 'Username' }).fill(username)
        await dialog.getByRole('textbox', { name: 'Password' }).click()
        await shell.keyboard.press('ControlOrMeta+A')
        await shell.keyboard.type(password)
        await expect(dialog.getByRole('textbox', { name: 'Username' })).toHaveValue(username, {
          timeout: 1_000,
        })
        await expect(dialog.getByRole('textbox', { name: 'Password' })).toHaveValue(password, {
          timeout: 1_000,
        })
      }).toPass({ timeout: 10_000 })
    }
    const expectQuiet = async (openedBefore: string[]) => {
      await sleep(QUIET_MS)
      expect(await pagePrompt()).toBeNull()
      expect(await launchNotice()).toBeNull()
      expect(await openedExternal()).toEqual(openedBefore)
    }

    await execute('browser_open_url', { url: `${site}/next` })
    await panelAction({ action: 'switch-tab', tabId: '1' })
    await expect.poll(titleAt(`${site}/next`)).toBe('next')

    await check('an older renderer leaves sign-in challenges and app links refused', async () => {
      await panelAction({ action: 'enable-page-dialogs' })
      await navigate(`${site}/basic`)
      await expect.poll(titleAt(`${site}/basic`)).toBe('denied')
      expect(await pagePrompt()).toBeNull()
      await navigate(`${site}/links`)
      await expect.poll(titleAt(`${site}/links`)).toBe('links')
      await userClick(`${site}/links`, '#app')
      await expectQuiet([])
    })

    await panelAction({ action: 'enable-page-dialogs', pagePrompts: true })

    await check(
      'basic auth asks for the page, re-asks after a wrong password, then signs in',
      async () => {
        await panelAction({ action: 'navigate', url: `${site}/basic` })
        await expect.poll(pagePrompt).toMatchObject({
          kind: 'http-auth',
          origin: site,
          proxy: false,
          insecure: true,
          retry: false,
        })
        await expect(shell.getByText('Your connection to this site is not private.')).toBeVisible()
        await signInAs('alice', 'wrong')
        await shell.getByRole('button', { name: 'Sign in', exact: true }).click()
        await expect.poll(pagePrompt).toMatchObject({ kind: 'http-auth', retry: true })
        await expect(shell.getByText('Incorrect username or password.')).toBeVisible()
        await signInAs('alice', 's3cret')
        await shell.getByRole('button', { name: 'Sign in', exact: true }).click()
        await expect.poll(titleAt(`${site}/basic`)).toBe('secret')
        expect(await pagePrompt()).toBeNull()
      }
    )

    await check('a cross-origin subresource challenge never asks', async () => {
      const before = challenges.length
      await navigate(`${site}/subresource`)
      await expect.poll(titleAt(`${site}/subresource`)).toBe('img-failed')
      expect(challenges.slice(before)).toContain(`${otherPort}/basic`)
      expect(await pagePrompt()).toBeNull()
    })

    await check(
      "the agent's sign-in challenge waits for the user instead of being answered",
      async () => {
        const navigation = startTool('browser_navigate', { url: `${crossSite}/basic` })
        await expect.poll(pagePrompt).toMatchObject({ kind: 'http-auth', origin: crossSite })
        await sleep(QUIET_MS)
        expect(await pagePrompt()).toMatchObject({ kind: 'http-auth', retry: false })
        await signInAs('alice', 's3cret')
        await shell.getByRole('button', { name: 'Sign in', exact: true }).click()
        const result = await navigation
        expect(result.ok, result.error).toBe(true)
        await expect.poll(titleAt(`${crossSite}/basic`)).toBe('secret')
      }
    )

    await check("the agent's clicks never open another app", async () => {
      await navigate(`${site}/links`)
      const opened = await openedExternal()
      const snapshot = await execute('browser_snapshot', {})
      const ref = /link "Join meeting" \[ref=(\d+)\]/.exec(
        String((snapshot as { outline?: string }).outline)
      )?.[1]
      expect(ref, 'snapshot lists the Join meeting link').toBeTruthy()
      const result = await execute('browser_click', { elementId: Number(ref) })
      await expectQuiet(opened)
      const notices = [
        ...((result as { notices?: string[] }).notices ?? []),
        ...(((await execute('browser_snapshot', {})) as { notices?: string[] }).notices ?? []),
      ]
      expect(notices.join('\n')).toContain('never open from agent actions')
    })

    await check('a link to another app asks after a click and opens only on Open', async () => {
      await userClick(`${site}/links`, '#app')
      await expect.poll(pagePrompt).toMatchObject({
        kind: 'external-app',
        origin: site,
        appName: 'Fixture Meetings',
        canAlwaysAllow: false,
      })
      const open = shell.getByRole('button', { name: 'Open', exact: true })
      await expect(open).toBeVisible()
      expect(await openedExternal()).toEqual([])
      await expect(open).toBeEnabled()
      await open.click()
      await expect.poll(openedExternal).toEqual(['simfixture://join?id=7'])
      expect(await pagePrompt()).toBeNull()
    })

    await check('without a click, a page only offers to open the app', async () => {
      await navigate(`${site}/auto`)
      await expect.poll(launchNotice).toMatchObject({ appName: 'Fixture Meetings', origin: site })
      expect(await pagePrompt()).toBeNull()
      expect(await openedExternal()).toEqual(['simfixture://join?id=7'])
      await shell.getByRole('button', { name: 'Open', exact: true }).click()
      await expect.poll(openedExternal).toEqual(['simfixture://join?id=7', 'simfixture://auto'])
      await expect.poll(launchNotice).toBeNull()
    })

    await check('a page cannot keep asking to open apps', async () => {
      await navigate(`${site}/links`)
      await userClick(`${site}/links`, '#app')
      await expectQuiet(['simfixture://join?id=7', 'simfixture://auto'])
    })

    await check(
      'denied and unhandled schemes never open, mail links open after a click',
      async () => {
        await shell.evaluate(
          (scope) => (globalThis as Bridge).simDesktop.browserAgent.openTab?.(scope),
          SCOPE
        )
        const opened = await openedExternal()
        // A fresh document per link: one page's refused launch must not mask the next.
        let links = ''
        for (const [index, selector] of ['#denied', '#unhandled'].entries()) {
          links = `${site}/links?tab=2&link=${index}`
          await navigate(links)
          await userClick(links, selector)
          await expectQuiet(opened)
        }
        await userClick(links, '#mail')
        await expect.poll(openedExternal).toEqual([...opened, 'mailto:a@example.com?subject=Hi'])
        expect(await pagePrompt()).toBeNull()
      }
    )

    await check('a passkey sign-in lets the user choose the account', async () => {
      const passkeyPage = `${site}/next?passkey`
      await navigate(passkeyPage)
      await shellApp.evaluate(async ({ webContents }) => {
        const contents = webContents
          .getAllWebContents()
          .find((candidate) => candidate.getURL().includes('/next?passkey'))
        if (!contents) throw new Error('No passkey page')
        if (!contents.debugger.isAttached()) contents.debugger.attach('1.3')
        await contents.debugger.sendCommand('WebAuthn.enable', { enableUI: false })
        await contents.debugger.sendCommand('WebAuthn.addVirtualAuthenticator', {
          options: {
            protocol: 'ctap2',
            transport: 'internal',
            hasResidentKey: true,
            hasUserVerification: true,
            isUserVerified: true,
            automaticPresenceSimulation: true,
          },
        })
      })
      const created = await pageAt<string>(
        passkeyPage,
        `(async () => {
        const make = (id, name) => navigator.credentials.create({ publicKey: {
          challenge: new Uint8Array(16), rp: { id: 'localhost', name: 'Fixture' },
          user: { id: new TextEncoder().encode(id), name, displayName: name },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
        } })
        await make('user-ada', 'ada@example.com')
        await make('user-grace', 'grace@example.com')
        globalThis.passkeyResult = navigator.credentials.get({ publicKey: {
          challenge: new Uint8Array(16), rpId: 'localhost', userVerification: 'preferred',
        } }).then((credential) => new TextDecoder().decode(credential.response.userHandle),
          (error) => 'error:' + error.name)
        return 'created'
      })()`
      )
      expect(created).toBe('created')
      await expect.poll(pagePrompt).toMatchObject({
        kind: 'passkey-account',
        relyingPartyId: 'localhost',
      })
      const prompt = await pagePrompt()
      expect(
        prompt?.kind === 'passkey-account' && prompt.accounts.map((account) => account.name).sort()
      ).toEqual(['ada@example.com', 'grace@example.com'])
      // A stray Enter must never send an identity: nothing is preselected, and Enter refuses.
      await shell.keyboard.press('Enter')
      await expect
        .poll(() => pageAt<string>(passkeyPage, 'globalThis.passkeyResult'))
        .toBe('error:NotAllowedError')
      await pageAt(
        passkeyPage,
        `globalThis.passkeyResult = navigator.credentials.get({ publicKey: {
          challenge: new Uint8Array(16), rpId: 'localhost', userVerification: 'preferred',
        } }).then((credential) => new TextDecoder().decode(credential.response.userHandle),
          (error) => 'error:' + error.name); 'asked'`
      )
      await expect.poll(pagePrompt).toMatchObject({ kind: 'passkey-account' })
      const dialog = shell.getByRole('dialog')
      await dialog.getByRole('button').filter({ hasText: 'Choose an account' }).click()
      await shell.getByRole('menuitemradio', { name: 'grace@example.com' }).click()
      await shell.getByRole('button', { name: 'Continue', exact: true }).click()
      await expect
        .poll(() => pageAt<string>(passkeyPage, 'globalThis.passkeyResult'))
        .toBe('user-grace')
      expect(await pagePrompt()).toBeNull()
    })
    passed = true
  } finally {
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, JSON.stringify({ passed, checks }, null, 2))
    await app?.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await new Promise<void>((resolve) => otherSite.close(() => resolve()))
    rmSync(userData, { recursive: true, force: true })
  }
})
