import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import type {
  BrowserAppLaunchNotice,
  BrowserPagePrompt,
  BrowserPanelAction,
  BrowserToolName,
} from '@sim/browser-protocol'
import { sleep } from '@sim/utils/helpers'
import {
  BROWSER_SESSION_COMPONENTS,
  focusedPageUrl,
  inPage,
  openShell,
  panelAction,
  serveShellAndSite,
  titleAt,
  userInput,
} from './browser-page'
import {
  test as base,
  bundleSimFixture,
  type DesktopBridge,
  expect,
  type FixtureHandler,
  SIM_DIR,
  type SimFixtureBundle,
  serve,
  ToolAuthorizer,
} from './harness'

const SCOPE = 'browser-sign-in-prompts-e2e'
const SHELL = { heading: 'Browser sign-in fixture', top: 120 }
const CREDENTIALS = `Basic ${Buffer.from('alice:s3cret').toString('base64')}`
/** Long enough for a refused request to have surfaced if it were going to. */
const QUIET_MS = 1_500

type FixtureGlobals = DesktopBridge & {
  pagePrompt?: BrowserPagePrompt | null
  launchNotice?: BrowserAppLaunchNotice | null
}

type MainGlobals = typeof globalThis & { openedExternal?: string[] }

let fixtureBundle: Promise<SimFixtureBundle> | undefined
function shellBundle(): Promise<SimFixtureBundle> {
  if (!fixtureBundle) {
    fixtureBundle = bundleSimFixture({
      source: `import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useBrowserSessionStore as store } from ${JSON.stringify(join(SIM_DIR, 'stores/browser-session/store.ts'))};
import { BrowserAppLaunchNoticeBar, BrowserPagePromptModal } from ${JSON.stringify(join(BROWSER_SESSION_COMPONENTS, 'browser-page-prompt.tsx'))};
import { useBrowserPanelOcclusion } from ${JSON.stringify(join(BROWSER_SESSION_COMPONENTS, 'browser-panel-occlusion.ts'))};
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
    })
  }
  return fixtureBundle
}

/** Every link records trusted and agent clicks, so a test can tell a click landed. */
const LINKS_FIXTURE = `<!doctype html><title>links</title>
<script>addEventListener('click', (event) => {
  const link = event.target.closest('a')
  if (link) link.dataset.clicks = String(Number(link.dataset.clicks ?? 0) + 1)
}, true)</script>
<p><a id="app" href="simfixture://join?id=7">Join meeting</a></p>
<p><a id="denied" href="ms-msdt:id">Diagnostics</a></p>
<p><a id="unhandled" href="nohandler://x">Unhandled</a></p>
<p><a id="mail" href="mailto:a@example.com?subject=Hi">Mail</a></p>`

interface SignInBrowser {
  app: ElectronApplication
  shell: Page
  /** The web, on the shell's own server. */
  site: string
  /** A second web origin, for cross-origin challenges. */
  crossSite: string
  /** `site/basic` or `cross-site/basic`, per challenge served. */
  challenges: string[]
  act(action: BrowserPanelAction): Promise<void>
  startTool(
    tool: BrowserToolName,
    args: Record<string, unknown>
  ): Promise<{ ok: boolean; error?: string }>
  execute(tool: BrowserToolName, args: Record<string, unknown>): Promise<unknown>
  pagePrompt(): Promise<BrowserPagePrompt | null>
  launchNotice(): Promise<BrowserAppLaunchNotice | null>
  openedExternal(): Promise<string[]>
  /** Navigates from the URL bar and waits for the page to finish loading with `title`. */
  navigate(url: string, title: string): Promise<void>
  /** A trusted click on a link, waited on until the page saw it. */
  clickLink(url: string, selector: string): Promise<void>
  /** Signs in through the visible sign-in prompt the way the user does. */
  signInAs(username: string, password: string): Promise<void>
  /** Nothing asks and nothing opens, after a click that landed. */
  expectQuiet(openedBefore: string[]): Promise<void>
}

/**
 * A browser tab's sign-in challenges and links to other apps belong to the
 * user: Sim shows the question for the tab that asked, only a click in Sim
 * answers it, and nothing is asked of an older renderer that cannot show it.
 * These checks drive the real shell, native tab views, and Sim's prompt UI.
 */
const test = base.extend<{ signIn: SignInBrowser }>({
  signIn: async ({ desktop }, use) => {
    const challenges: string[] = []
    const siteHandler =
      (label: string): FixtureHandler =>
      (request, response, url) => {
        if (url.pathname === '/basic') {
          challenges.push(`${label}/basic`)
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
        if (url.pathname === '/subresource') {
          response.end(
            `<!doctype html><title>sub</title><img src="${crossSite.site}/basic" onerror="document.title='img-failed'" onload="document.title='img-loaded'">`
          )
        } else if (url.pathname === '/links') {
          response.end(LINKS_FIXTURE)
        } else if (url.pathname === '/auto') {
          response.end(
            `<!doctype html><title>auto</title><script>location.href = 'simfixture://auto'</script>`
          )
        } else {
          response.end('<!doctype html><title>next</title>')
        }
      }
    const crossSite = await serve(siteHandler('cross-site'))
    const authorizer = new ToolAuthorizer('browser-signin')
    const server = await serveShellAndSite({
      ...SHELL,
      bundle: await shellBundle(),
      authorizer,
      site: siteHandler('site'),
    })
    try {
      const { app } = await desktop.launch({ origin: server.origin })
      // Launching real apps is out of scope: record what the shell would hand the OS,
      // and register a fixture handler for the schemes the page links to.
      await app.evaluate(({ app, shell }) => {
        const main = globalThis as MainGlobals
        main.openedExternal = []
        shell.openExternal = async (url: string) => {
          main.openedExternal?.push(url)
        }
        app.getApplicationNameForProtocol = (url: string) =>
          /^(simfixture|ms-msdt|mailto):/i.test(url) ? 'Fixture Meetings' : ''
      })
      const shell = await openShell(app, SCOPE, SHELL)
      const site = server.site
      const act = (action: BrowserPanelAction) => panelAction(shell, SCOPE, action)
      const startTool = (tool: BrowserToolName, args: Record<string, unknown>) => {
        const callId = authorizer.issue(SCOPE, tool, args)
        return shell.evaluate(
          ({ callId, tool, args, scope }) =>
            (globalThis as DesktopBridge).simDesktop.browserAgent.executeTool(
              callId,
              tool,
              args,
              scope
            ),
          { callId, tool, args, scope: SCOPE }
        )
      }
      const pagePrompt = () =>
        shell.evaluate(() => (globalThis as FixtureGlobals).pagePrompt ?? null)
      const launchNotice = () =>
        shell.evaluate(() => (globalThis as FixtureGlobals).launchNotice ?? null)
      const openedExternal = () =>
        app.evaluate(() => [...((globalThis as MainGlobals).openedExternal ?? [])])

      await authorizer.execute(shell, SCOPE, 'browser_open_url', { url: `${site}/next` })
      await act({ action: 'switch-tab', tabId: '1' })
      await expect.poll(() => titleAt(app, `${site}/next`)).toBe('next')

      await use({
        app,
        shell,
        site,
        crossSite: crossSite.site,
        challenges,
        act,
        startTool,
        execute: (tool, args) => authorizer.execute(shell, SCOPE, tool, args),
        pagePrompt,
        launchNotice,
        openedExternal,
        async navigate(url, title) {
          await act({ action: 'navigate', url })
          await expect.poll(() => titleAt(app, url)).toBe(title)
          await expect.poll(() => inPage(app, url, 'document.readyState')).toBe('complete')
        },
        async clickLink(url, selector) {
          const clicks = () =>
            inPage<number>(
              app,
              url,
              `Number(document.querySelector(${JSON.stringify(selector)}).dataset.clicks ?? 0)`
            )
          const before = await clicks()
          await userInput(app, url, selector)
          await expect.poll(clicks).toBe(before + 1)
        },
        async signInAs(username, password) {
          const dialog = shell.getByRole('dialog')
          await expect(dialog).toHaveCount(1)
          const usernameField = dialog.getByRole('textbox', { name: 'Username' })
          const passwordField = dialog.getByRole('textbox', { name: 'Password' })
          await usernameField.fill(username)
          // The password field stays read-only until it takes focus, which keeps autofill out.
          await passwordField.click()
          await expect(passwordField).toBeEditable()
          await passwordField.fill(password)
          await expect(usernameField).toHaveValue(username)
          await expect(passwordField).toHaveValue(password)
        },
        async expectQuiet(openedBefore) {
          await sleep(QUIET_MS)
          expect(await pagePrompt()).toBeNull()
          expect(await launchNotice()).toBeNull()
          expect(await openedExternal()).toEqual(openedBefore)
        },
      })
    } finally {
      await server.close()
      await crossSite.close()
    }
  },
})

test('sign-in challenges and passkeys wait for the user on the page that asked', async ({
  signIn,
}) => {
  const { app, shell, site, crossSite } = signIn
  const titleOf = (url: string) => () => titleAt(app, url)
  const signInButton = shell.getByRole('button', { name: 'Sign in', exact: true })

  await test.step('an older renderer leaves sign-in challenges refused', async () => {
    await signIn.act({ action: 'enable-page-dialogs' })
    await signIn.navigate(`${site}/basic`, 'denied')
    expect(await signIn.pagePrompt()).toBeNull()
  })

  await signIn.act({ action: 'enable-page-dialogs', pagePrompts: true })

  await test.step('basic auth asks for the page, re-asks after a wrong password, then signs in', async () => {
    await signIn.act({ action: 'navigate', url: `${site}/basic` })
    await expect.poll(signIn.pagePrompt).toMatchObject({
      kind: 'http-auth',
      origin: site,
      proxy: false,
      insecure: true,
      retry: false,
    })
    await expect(shell.getByText('Your connection to this site is not private.')).toBeVisible()
    await signIn.signInAs('alice', 'wrong')
    await signInButton.click()
    await expect.poll(signIn.pagePrompt).toMatchObject({ kind: 'http-auth', retry: true })
    await expect(shell.getByText('Incorrect username or password.')).toBeVisible()
    await signIn.signInAs('alice', 's3cret')
    await signInButton.click()
    await expect.poll(titleOf(`${site}/basic`)).toBe('secret')
    expect(await signIn.pagePrompt()).toBeNull()
  })

  await test.step('a cross-origin subresource challenge never asks', async () => {
    const before = signIn.challenges.length
    await signIn.navigate(`${site}/subresource`, 'img-failed')
    expect(signIn.challenges.slice(before)).toContain('cross-site/basic')
    expect(await signIn.pagePrompt()).toBeNull()
  })

  await test.step("the agent's sign-in challenge waits for the user instead of being answered", async () => {
    const navigation = signIn.startTool('browser_navigate', { url: `${crossSite}/basic` })
    await expect.poll(signIn.pagePrompt).toMatchObject({ kind: 'http-auth', origin: crossSite })
    await sleep(QUIET_MS)
    expect(await signIn.pagePrompt()).toMatchObject({ kind: 'http-auth', retry: false })
    await signIn.signInAs('alice', 's3cret')
    await signInButton.click()
    const result = await navigation
    expect(result.ok, result.error).toBe(true)
    await expect.poll(titleOf(`${crossSite}/basic`)).toBe('secret')
  })

  await test.step('a passkey sign-in lets the user choose the account', async () => {
    const passkeyPage = `${site}/next?passkey`
    await signIn.navigate(passkeyPage, 'next')
    // WebAuthn only answers a focused document, and the user's click is what focuses it.
    await userInput(app, passkeyPage, 'html')
    await expect.poll(() => focusedPageUrl(app)).toBe(passkeyPage)
    await app.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((c) => c.getURL() === url)
      if (!contents) throw new Error(`No page at ${url}`)
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
    }, passkeyPage)
    const askForPasskey = `globalThis.passkeyOutcome = 'pending'
      navigator.credentials.get({ publicKey: {
        challenge: new Uint8Array(16), rpId: 'localhost', userVerification: 'preferred',
      } }).then((credential) => new TextDecoder().decode(credential.response.userHandle),
        (error) => 'error:' + error.name).then((outcome) => { globalThis.passkeyOutcome = outcome })`
    const created = await inPage<string>(
      app,
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
        ${askForPasskey}
        return 'created'
      })()`,
      { userGesture: true }
    )
    expect(created).toBe('created')
    await expect.poll(signIn.pagePrompt).toMatchObject({
      kind: 'passkey-account',
      relyingPartyId: 'localhost',
    })
    const prompt = await signIn.pagePrompt()
    expect(
      prompt?.kind === 'passkey-account' && prompt.accounts.map((account) => account.name).sort()
    ).toEqual(['ada@example.com', 'grace@example.com'])

    // A stray Enter in the prompt must never send an identity: nothing is preselected and
    // Enter does not continue.
    const passkeyOutcome = () => inPage<string>(app, passkeyPage, 'globalThis.passkeyOutcome')
    const dialog = shell.getByRole('dialog')
    await dialog.focus()
    await expect(dialog).toBeFocused()
    await shell.keyboard.press('Enter')
    await sleep(QUIET_MS)
    expect(await passkeyOutcome()).toBe('pending')
    expect(await signIn.pagePrompt()).toMatchObject({ kind: 'passkey-account' })
    await shell.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect.poll(passkeyOutcome).toBe('error:NotAllowedError')

    await inPage(app, passkeyPage, `${askForPasskey}; 'asked'`, { userGesture: true })
    await expect.poll(signIn.pagePrompt).toMatchObject({ kind: 'passkey-account' })
    await dialog.getByRole('button').filter({ hasText: 'Choose an account' }).click()
    await shell.getByRole('menuitemradio', { name: 'grace@example.com' }).click()
    await shell.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect.poll(passkeyOutcome).toBe('user-grace')
    expect(await signIn.pagePrompt()).toBeNull()
  })
})

test("links to other apps open only after the user's click and their answer", async ({
  signIn,
}) => {
  const { shell, site } = signIn
  const links = `${site}/links`
  const open = shell.getByRole('button', { name: 'Open', exact: true })

  await test.step('an older renderer leaves app links refused', async () => {
    await signIn.act({ action: 'enable-page-dialogs' })
    await signIn.navigate(links, 'links')
    await signIn.clickLink(links, '#app')
    await signIn.expectQuiet([])
  })

  await signIn.act({ action: 'enable-page-dialogs', pagePrompts: true })

  await test.step("the agent's clicks never open another app", async () => {
    await signIn.navigate(links, 'links')
    const snapshot = await signIn.execute('browser_snapshot', {})
    const ref = /link "Join meeting" \[ref=(\d+)\]/.exec(
      String((snapshot as { outline?: string }).outline)
    )?.[1]
    expect(ref, 'snapshot lists the Join meeting link').toBeTruthy()
    const result = await signIn.execute('browser_click', { elementId: Number(ref) })
    await signIn.expectQuiet([])
    const notices = [
      ...((result as { notices?: string[] }).notices ?? []),
      ...(((await signIn.execute('browser_snapshot', {})) as { notices?: string[] }).notices ?? []),
    ]
    expect(notices.join('\n')).toContain('never open from agent actions')
  })

  await test.step('a link to another app asks after a click and opens only on Open', async () => {
    await signIn.clickLink(links, '#app')
    await expect.poll(signIn.pagePrompt).toMatchObject({
      kind: 'external-app',
      origin: site,
      appName: 'Fixture Meetings',
      canAlwaysAllow: false,
    })
    await expect(open).toBeVisible()
    expect(await signIn.openedExternal()).toEqual([])
    await expect(open).toBeEnabled()
    await open.click()
    await expect.poll(signIn.openedExternal).toEqual(['simfixture://join?id=7'])
    expect(await signIn.pagePrompt()).toBeNull()
  })

  await test.step('without a click, a page only offers to open the app', async () => {
    await signIn.navigate(`${site}/auto`, 'auto')
    await expect
      .poll(signIn.launchNotice)
      .toMatchObject({ appName: 'Fixture Meetings', origin: site })
    expect(await signIn.pagePrompt()).toBeNull()
    expect(await signIn.openedExternal()).toEqual(['simfixture://join?id=7'])
    await open.click()
    await expect
      .poll(signIn.openedExternal)
      .toEqual(['simfixture://join?id=7', 'simfixture://auto'])
    await expect.poll(signIn.launchNotice).toBeNull()
  })

  await test.step('a page cannot keep asking to open apps', async () => {
    await signIn.navigate(links, 'links')
    await signIn.clickLink(links, '#app')
    await signIn.expectQuiet(['simfixture://join?id=7', 'simfixture://auto'])
  })

  await test.step('denied and unhandled schemes never open, mail links open after a click', async () => {
    await shell.evaluate(
      (scope) => (globalThis as DesktopBridge).simDesktop.browserAgent.openTab?.(scope),
      SCOPE
    )
    const opened = await signIn.openedExternal()
    // A fresh document per link: one page's refused launch must not mask the next.
    let page = ''
    for (const [index, selector] of ['#denied', '#unhandled'].entries()) {
      page = `${site}/links?tab=2&link=${index}`
      await signIn.navigate(page, 'links')
      await signIn.clickLink(page, selector)
      await signIn.expectQuiet(opened)
    }
    await signIn.clickLink(page, '#mail')
    await expect.poll(signIn.openedExternal).toEqual([...opened, 'mailto:a@example.com?subject=Hi'])
    expect(await signIn.pagePrompt()).toBeNull()
  })
})
