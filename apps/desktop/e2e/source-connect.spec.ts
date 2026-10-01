import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, _electron as electron, expect, test } from '@playwright/test'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { generateShortId } from '@sim/utils/id'
import { build } from 'esbuild'
import postcss from 'postcss'
import loadPostcssConfig from 'postcss-load-config'

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))
const SIM_DIR = fileURLToPath(new URL('../../sim/', import.meta.url))
const FIXTURE = fileURLToPath(
  new URL('../../sim/scripts/fixtures/desktop-source-connect.tsx', import.meta.url)
)

/** Real renderer, preload, main process, loopback, and a separate browser cookie jar. */
test('source authorization returns to its desktop screen and refreshes live', async () => {
  const reportPath =
    process.env.DESKTOP_SOURCE_CONNECT_REPORT_PATH ?? test.info().outputPath('source-connect.json')
  const checks: {
    name: string
    status: 'passed' | 'failed'
    durationMs: number
    error?: string
  }[] = []
  const check = async (name: string, action: () => Promise<void>) => {
    const started = Date.now()
    try {
      await test.step(name, action)
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
  const tickets = new Map<string, unknown>()
  const attempts = new Map<string, string>()
  const accountAttempts = new Map<string, { session: string; mcp: boolean }>()
  let accountConnected = false
  let mcpAccountConnected = false
  const startSessions: string[] = []
  const callbackSessions: string[] = []
  const githubAttempts = new Map<string, { session: string; completed: boolean }>()
  const githubStartSessions: string[] = []
  const githubInventorySessions: string[] = []
  let nativeCredentialVisible = false
  let installed = false
  let holdSlackStart = false
  let canceledSlackRequests = 0
  const personalAttempts = new Map<string, { session: string; completed: boolean }>()
  let personalInventoryFailed = false
  let personalInventoryFailures = 0
  let javascript = ''
  let stylesheet = ''
  let origin = ''
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  const userData = mkdtempSync(join(tmpdir(), 'sim-source-connect-e2e-'))
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', origin || 'http://localhost')
    const path = url.pathname
    const session = request.headers.cookie?.includes('browser-fixture')
      ? 'browser-fixture'
      : 'desktop-fixture'
    const json = (value: unknown, status = 200) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(value))
    }
    const redirect = (target: string) => {
      response.writeHead(303, { location: target })
      response.end()
    }
    const body = async () => {
      let text = ''
      for await (const chunk of request) text += chunk.toString()
      return JSON.parse(text)
    }
    if (path === '/fixture.js' || path === '/fixture.css') {
      response.setHeader('content-type', path.endsWith('.js') ? 'text/javascript' : 'text/css')
      response.end(path.endsWith('.js') ? javascript : stylesheet)
      return
    }
    if (path === '/api/organizations/fixture-organization/connected-accounts') {
      json({
        credentialGroup: null,
        availableProviders: [],
        availableMcpConnectors: [],
        canManage: false,
        indexingAvailable: true,
        viewerMcpAccounts: mcpAccountConnected
          ? [
              {
                credentialId: 'fixture-mcp-account',
                displayName: 'Fixture MCP account',
                mcpServerId: 'fixture-mcp',
                status: 'active',
              },
            ]
          : [],
        viewerAccounts: accountConnected
          ? [
              {
                credentialId: 'fixture-account',
                displayName: 'Fixture account',
                providerId: 'google-drive',
                groupId: 'fixture-group',
                optionId: 'fixture-option',
                status: 'active',
              },
            ]
          : [],
      })
      return
    }
    if (
      path === '/api/organizations/fixture-organization/connected-accounts/connect' ||
      path === '/api/users/me/organization-accounts/fixture-account/reconnect'
    ) {
      const input = request.method === 'POST' && path.endsWith('/connect') ? await body() : null
      const completionId = input?.oauthCompletionId ?? url.searchParams.get('oauthCompletionId')
      if (!completionId) {
        json({ error: 'Missing completion ID' }, 400)
        return
      }
      accountAttempts.set(completionId, { session, mcp: Boolean(input?.mcpServerId) })
      json({
        invitationLink: `${origin}/credential-groups/enroll/fixture-account-invitation`,
        authorizationUrl: `${origin}/account-provider?completionId=${completionId}`,
      })
      return
    }
    if (path === '/account-callback') {
      const completionId = url.searchParams.get('completionId') ?? ''
      const attempt = accountAttempts.get(completionId)
      if (attempt?.session !== session) {
        json({ error: 'Wrong attempt' }, 403)
        return
      }
      accountAttempts.delete(completionId)
      const denied = url.searchParams.has('error')
      if (!denied) {
        if (attempt.mcp) mcpAccountConnected = true
        else accountConnected = true
      }
      redirect(
        `/credential-groups/complete?completionId=${completionId}&organizationId=fixture-organization${denied ? '&oauth=denied' : ''}`
      )
      return
    }
    if (path === '/api/auth/get-session') {
      json({ user: { id: 'fixture-user' }, session: { id: session } })
      return
    }
    if (path === '/api/desktop/source-connect') {
      const { requestId, request: sourceRequest } = await body()
      if (startSessions.length === 0) await sleep(5_500)
      tickets.set(requestId, sourceRequest)
      json({ requestId })
      return
    }
    if (path === '/api/desktop/source-connect/consume') {
      const { requestId } = await body()
      const ticket = tickets.get(requestId)
      tickets.delete(requestId)
      json(ticket ?? { error: 'expired' }, ticket ? 200 : 404)
      return
    }
    if (path === '/api/knowledge/slack/oauth') {
      await body()
      const state = generateShortId(32)
      attempts.set(state, session)
      startSessions.push(session)
      if (holdSlackStart) {
        response.on('close', () => {
          if (!response.writableEnded) canceledSlackRequests++
        })
        return
      }
      json({ authorizationUrl: `${origin}/provider?state=${state}` })
      return
    }
    if (path === '/api/knowledge/sim-search/personal-integrations') {
      if (request.method === 'POST') {
        const { oauthCompletionId } = await body()
        personalAttempts.set(oauthCompletionId, { session, completed: false })
        json({
          success: true,
          data: { url: `${origin}/personal-provider?completionId=${oauthCompletionId}` },
        })
      } else if (personalInventoryFailed) {
        personalInventoryFailures++
        json({ error: 'Inventory temporarily unavailable' }, 503)
      } else {
        const attempt = personalAttempts.get(url.searchParams.get('completionId') ?? '')
        const connected = attempt?.completed === true
        json({
          success: true,
          data: {
            completedCredentialId: connected ? 'fixture-personal-account' : null,
            connections: connected
              ? [
                  {
                    name: 'Slack',
                    providerId: 'slack',
                    connectorType: 'slack',
                    description: '',
                    accounts: [
                      {
                        credentialId: 'fixture-personal-account',
                        displayName: 'Fixture',
                        status: 'connected',
                        action: null,
                      },
                    ],
                    connectionStatus: 'connected',
                    action: null,
                  },
                ]
              : [],
            available: [
              {
                name: 'Slack',
                description: '',
                target: {
                  type: 'link',
                  provider: 'slack',
                  connectorType: 'slack',
                  connectionMode: 'live',
                  optionId: 'fixture-option',
                },
              },
            ],
            nextCursor: null,
          },
        })
      }
      return
    }
    if (path === '/personal-callback') {
      const completionId = url.searchParams.get('completionId') ?? ''
      const attempt = personalAttempts.get(completionId)
      if (!attempt || attempt.session !== session) {
        json({ error: 'Wrong attempt' }, 403)
        return
      }
      attempt.completed = true
      redirect(`/credential-groups/complete?completionId=${completionId}`)
      return
    }
    if (path === '/api/knowledge/slack/oauth/callback') {
      const state = url.searchParams.get('state') ?? ''
      callbackSessions.push(session)
      const ok = attempts.get(state) === session && url.searchParams.has('code')
      attempts.delete(state)
      if (ok) installed = true
      const reason =
        url.searchParams.get('error') === 'session_expired' ? '&reason=signin_required' : ''
      redirect(`/credential-groups/slack-complete?state=${state}&ok=${ok}${reason}`)
      return
    }
    if (
      path ===
      '/api/knowledge/00000000-0000-4000-8000-000000000001/connectors/fixture-connector/enroll'
    ) {
      if (url.searchParams.has('oauthCompletionId'))
        json({ error: 'Direct account connection requires a Search source' }, 400)
      else
        json({
          success: true,
          data: { url: `${origin}/credential-groups/enroll/fixture-invitation` },
        })
      return
    }
    if (path === '/api/knowledge/github/setup') {
      if (request.method === 'POST') {
        const { setupId } = await body()
        githubStartSessions.push(session)
        githubAttempts.set(setupId, { session, completed: false })
        json({ success: true, url: `${origin}/github-provider?setupId=${setupId}` })
      } else {
        const attempt = githubAttempts.get(url.searchParams.get('setupId') ?? '')
        if (!attempt || attempt.session !== session) json({ error: 'Wrong session' }, 403)
        else
          json({
            success: true,
            data: attempt.completed
              ? {
                  status: 'completed',
                  credential: { id: 'fixture-github-credential', displayName: 'Fixture GitHub' },
                }
              : { status: 'pending' },
          })
      }
      return
    }
    if (path === '/api/organization-credentials/oauth') {
      githubInventorySessions.push(session)
      await sleep(500)
      json({
        credentials: nativeCredentialVisible
          ? [
              {
                id: 'fixture-github-credential',
                name: 'Fixture GitHub',
                provider: 'github-repositories',
              },
            ]
          : [],
      })
      return
    }
    if (path === '/api/organization-credentials') {
      json({ credentials: [] })
      return
    }
    if (path === '/github-callback') {
      const setupId = url.searchParams.get('setupId') ?? ''
      const attempt = githubAttempts.get(setupId)
      if (!attempt || attempt.session !== session) {
        json({ error: 'Wrong session' }, 403)
        return
      }
      attempt.completed = true
      redirect(`/credential-groups/complete?completionId=${setupId}`)
      return
    }
    if (path === '/api/knowledge/slack') {
      json({
        sharedAppAvailable: true,
        bots: [],
        installations: installed
          ? [
              {
                id: 'fixture-install',
                credentialId: 'fixture-credential',
                appId: 'fixture-app',
                teamId: 'fixture-team',
                teamName: 'Fixture',
                appKind: 'shared',
                enabled: true,
                needsValidation: false,
                lastOutcome: null,
                lastEventAt: null,
              },
            ]
          : [],
      })
      return
    }
    if (path === '/desktop/connect/complete') {
      const params = new URLSearchParams({ state: url.searchParams.get('state') ?? '' })
      if (url.searchParams.has('error')) params.set('error', url.searchParams.get('error')!)
      if (url.searchParams.has('credentialId'))
        params.set('credentialId', url.searchParams.get('credentialId')!)
      redirect(`http://127.0.0.1:${url.searchParams.get('port')}/connect/callback?${params}`)
      return
    }
    if (path.startsWith('/api/')) {
      json({})
      return
    }
    response.setHeader('content-type', 'text/html')
    if (path === '/account-provider') {
      response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
      const completionId = url.searchParams.get('completionId') ?? ''
      response.end(
        `<!doctype html><a href="/account-callback?completionId=${completionId}">Authorize account</a><a href="/account-callback?completionId=${completionId}&error=denied">Deny account</a>`
      )
      return
    }
    if (path === '/personal-provider') {
      response.end(
        `<!doctype html><a href="/personal-callback?completionId=${url.searchParams.get('completionId')}">Authorize personal Search</a>`
      )
      return
    }
    if (path === '/github-provider') {
      response.end(
        `<!doctype html><a href="/github-callback?setupId=${url.searchParams.get('setupId')}">Authorize GitHub</a>`
      )
      return
    }
    if (path === '/provider') {
      const state = url.searchParams.get('state') ?? ''
      response.end(
        `<!doctype html><a href="/api/knowledge/slack/oauth/callback?state=${state}&code=fixture">Authorize</a><a href="/api/knowledge/slack/oauth/callback?state=${state}&error=denied">Cancel</a><a href="/api/knowledge/slack/oauth/callback?state=${state}&error=session_expired">Session expired</a>`
      )
      return
    }
    if (path === '/desktop/done') {
      response.end('<!doctype html><p>Returned</p>')
      return
    }
    if (path === '/' || path === '/home')
      response.setHeader(
        'set-cookie',
        'better-auth.session_token=desktop-fixture; HttpOnly; SameSite=Lax; Path=/'
      )
    response.end(
      '<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'
    )
  })
  try {
    await check('launch the production source hook and native bridge', async () => {
      const config = await loadPostcssConfig({}, SIM_DIR)
      const cssPath = join(SIM_DIR, 'app/_styles/globals.css')
      const css = await postcss(config.plugins).process(
        `${readFileSync(cssPath, 'utf8')}\n@source ${JSON.stringify(FIXTURE)};`,
        { from: cssPath }
      )
      const bundle = await build({
        entryPoints: [FIXTURE],
        bundle: true,
        write: false,
        outfile: test.info().outputPath('fixture.js'),
        format: 'iife',
        platform: 'browser',
        tsconfig: join(SIM_DIR, 'tsconfig.json'),
        external: ['node:async_hooks'],
        inject: [fileURLToPath(new URL('./fixtures/browser-buffer.ts', import.meta.url))],
        banner: { js: 'var process={env:{NODE_ENV:"development"},browser:true};' },
        define: { 'process.env.NODE_ENV': '"development"' },
      })
      javascript = bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? ''
      stylesheet = `${css.css}\n${bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? ''}`
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing fixture address')
      origin = `http://127.0.0.1:${address.port}`
      app = await electron.launch({
        args: [process.env.SIM_DESKTOP_E2E_MAIN ?? '.'],
        cwd: DESKTOP_DIR,
        env: { ...process.env, SIM_DESKTOP_ORIGIN: origin, SIM_DESKTOP_USER_DATA: userData },
      })
      await app.evaluate(({ shell }) => {
        const global = globalThis as typeof globalThis & { openedUrls: string[] }
        global.openedUrls = []
        shell.openExternal = async (url) => {
          global.openedUrls.push(url)
        }
      })
      browser = await chromium.launch()
    })
    if (!app || !browser) throw new Error('Missing apps')
    const shell = app
    const page = await app.firstWindow()
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.reload()
    await expect.poll(() => pageErrors).toEqual([])
    const context = await browser.newContext()
    await context.addCookies([
      {
        name: 'better-auth.session_token',
        value: 'browser-fixture',
        url: origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ])
    const external = await context.newPage()
    const opened = () =>
      shell.evaluate(() => (globalThis as typeof globalThis & { openedUrls: string[] }).openedUrls)
    await check(
      'separate browser consent completes under its initiating session and refreshes desktop',
      async () => {
        await page.getByLabel('Source draft').fill('Preserved while connecting')
        await page.getByRole('button', { name: 'Connect Slack' }).click()
        await expect.poll(async () => (await opened()).length, { timeout: 15_000 }).toBe(1)
        expect(page.url()).toBe(`${origin}/home`)
        await expect(page.getByLabel('Connection')).toHaveText('pending')
        await external.goto((await opened())[0])
        await external.getByRole('link', { name: 'Authorize', exact: true }).click()
        await expect(page.getByLabel('Connection')).toHaveText('success')
        await expect(page.getByLabel('Accounts')).toHaveText('1')
        await expect(page.getByLabel('Source draft')).toHaveValue('Preserved while connecting')
        expect(startSessions).toEqual(['browser-fixture'])
        expect(callbackSessions).toEqual(['browser-fixture'])
        await expect(external).toHaveURL(`${origin}/desktop/done?kind=connect`)
      }
    )
    await check(
      'denied authorization returns an actionable error without navigating desktop',
      async () => {
        await page.getByRole('button', { name: 'Connect Slack' }).click()
        await expect.poll(async () => (await opened()).length, { timeout: 15_000 }).toBe(2)
        await external.goto((await opened())[1])
        await external.getByRole('link', { name: 'Cancel', exact: true }).click()
        await expect(page.getByLabel('Connection')).toHaveText('error')
        await expect(page.getByRole('alert')).toContainText('Try connecting again')
        expect(page.url()).toBe(`${origin}/home`)
        await expect(page.getByLabel('Accounts')).toHaveText('1')
      }
    )
    await check(
      'native cancellation rejects a stale callback without disrupting the next request',
      async () => {
        await page.getByRole('button', { name: 'Connect Slack' }).click()
        await expect.poll(async () => (await opened()).length, { timeout: 15_000 }).toBe(3)
        await external.goto((await opened())[2])
        await external.getByRole('link', { name: 'Authorize', exact: true }).waitFor()
        const staleCallback = await external
          .getByRole('link', { name: 'Authorize', exact: true })
          .getAttribute('href')
        await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(1)
        await page.getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(page.getByLabel('Connection')).toHaveText('error')
        const canceled = new URL((await opened())[2])
        const probe = `http://127.0.0.1:${canceled.searchParams.get('port')}/connect/callback?state=${'x'.repeat(32)}`
        await expect
          .poll(() =>
            fetch(probe).then(
              () => false,
              () => true
            )
          )
          .toBe(true)
        await page.getByRole('button', { name: 'Connect Slack' }).click()
        await expect.poll(async () => (await opened()).length, { timeout: 15_000 }).toBe(4)
        await external.goto(`${origin}${staleCallback}`)
        await expect(page.getByLabel('Connection')).toHaveText('pending')
        await external.goto((await opened())[3])
        await external.getByRole('link', { name: 'Authorize', exact: true }).click()
        await expect(page.getByLabel('Connection')).toHaveText('success')
        await expect(page.getByLabel('Source draft')).toHaveValue('Preserved while connecting')
      }
    )
    await check(
      'GitHub setup stays in the browser session and verifies the returned credential in desktop',
      async () => {
        await page.getByRole('button', { name: 'Connect GitHub' }).click()
        await expect.poll(async () => (await opened()).length).toBe(5)
        await external.goto((await opened())[4])
        await external.getByRole('link', { name: 'Authorize GitHub' }).click()
        await expect(page.getByLabel('GitHub error')).toContainText('not available')
        await expect(page.getByLabel('GitHub credential')).toHaveText('')
        nativeCredentialVisible = true
        await page.getByRole('button', { name: 'Connect GitHub' }).click()
        await expect.poll(async () => (await opened()).length).toBe(6)
        await external.goto((await opened())[5])
        await external.getByRole('link', { name: 'Authorize GitHub' }).click()
        await expect.poll(() => githubInventorySessions.length).toBe(2)
        await expect(page.getByLabel('GitHub pending')).toHaveText('true')
        await expect(page.getByLabel('GitHub credential')).toHaveText('fixture-github-credential')
        expect(githubStartSessions).toEqual(['browser-fixture', 'browser-fixture'])
        expect(githubInventorySessions).toEqual(['desktop-fixture', 'desktop-fixture'])
        await expect(page.getByLabel('GitHub pending')).toHaveText('false')
        expect(page.url()).toBe(`${origin}/home`)
      }
    )
    await check('ordinary knowledge-base enrollment preserves its invitation step', async () => {
      await page.getByRole('button', { name: 'Connect invited source' }).click()
      await expect.poll(async () => (await opened()).length).toBe(7)
      await external.goto((await opened())[6])
      await external.getByRole('link', { name: 'Authorize invited source' }).click()
      await expect(page.getByLabel('Enrollment pending')).toHaveText('false')
      await expect(page.getByLabel('Enrollment error')).toHaveText('')
      expect(page.url()).toBe(`${origin}/home`)
    })
    await check('browser sign-in failures retain recovery guidance on desktop', async () => {
      await page.getByRole('button', { name: 'Connect Slack' }).click()
      await expect.poll(async () => (await opened()).length).toBe(8)
      await external.goto((await opened())[7])
      await external.getByRole('link', { name: 'Session expired' }).click()
      await expect(page.getByLabel('Connection')).toHaveText('error')
      await expect(page.getByRole('alert')).toContainText('Sign in to Sim in your browser')
      expect(page.url()).toBe(`${origin}/home`)
    })
    await check('managed accounts return through the desktop completion handoff', async () => {
      await page.getByRole('button', { name: 'Connect MCP account', exact: true }).click()
      await expect.poll(async () => (await opened()).length).toBe(9)
      await external.goto((await opened())[8])
      await external.getByRole('link', { name: 'Authorize account' }).click()
      await expect(page.getByLabel('Account authorization', { exact: true })).toHaveText('success')
      await expect(page.getByLabel('Account count')).toHaveText('1')
      expect(page.url()).toBe(`${origin}/home`)
      await expect(page.getByLabel('Source draft')).toHaveValue('Preserved while connecting')
    })
    const web = await context.newPage()
    web.on('pageerror', (error) => pageErrors.push(error.message))
    await web.goto(`${origin}/o/fixture-organization/integrations?search=fixture`)
    await check(
      'web authorization preserves the origin and refreshes after an isolated provider window',
      async () => {
        accountConnected = false
        mcpAccountConnected = false
        await web.reload()
        await web.getByLabel('Source draft').fill('Web draft retained')
        await expect(web.getByLabel('Account count')).toHaveText('0')
        const popupReady = context.waitForEvent('page')
        await web.getByRole('button', { name: 'Connect account', exact: true }).click()
        const popup = await popupReady
        await popup.getByRole('link', { name: 'Authorize account' }).click()
        await expect(web.getByLabel('Account count')).toHaveText('1')
        await expect(web.getByLabel('Account authorization', { exact: true })).toHaveText('success')
        await expect(web.getByLabel('Source draft')).toHaveValue('Web draft retained')
        expect(web.url()).toBe(`${origin}/o/fixture-organization/integrations?search=fixture`)
      }
    )
    await check('overlapping connect and reconnect preserve the active authorization', async () => {
      const popupReady = context.waitForEvent('page')
      await web.getByRole('button', { name: 'Connect account', exact: true }).click()
      const popup = await popupReady
      await popup.getByRole('link', { name: 'Authorize account' }).waitFor()
      const pendingAttempts = accountAttempts.size
      await web.getByRole('button', { name: 'Reconnect account', exact: true }).click()
      await expect(web.getByLabel('Reconnect error')).toContainText('Finish or cancel')
      expect(accountAttempts.size).toBe(pendingAttempts)
      await expect(web.getByLabel('Account authorization', { exact: true })).toHaveText('pending')
      await popup.getByRole('link', { name: 'Authorize account' }).click()
      await expect(web.getByLabel('Account authorization', { exact: true })).toHaveText('success')
    })
    await check('web denial and cancellation leave the initiating page usable', async () => {
      const popupReady = context.waitForEvent('page')
      await web.getByRole('button', { name: 'Connect account', exact: true }).click()
      const popup = await popupReady
      await popup.getByRole('link', { name: 'Deny account' }).click()
      await expect(web.getByLabel('Account error')).toContainText('canceled')
      await popup.close()
      await expect(web.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
      const nextPopupReady = context.waitForEvent('page')
      await web.getByRole('button', { name: 'Connect account', exact: true }).click()
      const nextPopup = await nextPopupReady
      await nextPopup.getByRole('link', { name: 'Authorize account' }).waitFor()
      await expect(web.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(1)
      await web.getByRole('button', { name: 'Cancel', exact: true }).click()
      expect(pageErrors).toEqual([])
      await expect(web.getByLabel('Account error')).toContainText('canceled')
      await expect(web.getByRole('button', { name: 'Connect account', exact: true })).toBeEnabled()
      await expect(web.getByLabel('Account count')).toHaveText('1')
    })
    await check('reconnect uses the same completion lifecycle', async () => {
      const popupReady = context.waitForEvent('page')
      await web.getByRole('button', { name: 'Reconnect account', exact: true }).click()
      const popup = await popupReady
      await popup.getByRole('link', { name: 'Authorize account' }).click()
      await expect(web.getByLabel('Reconnect status')).toHaveText('success')
      await expect(web.getByLabel('Source draft')).toHaveValue('Web draft retained')
    })
    await check('blocked popups complete in the same tab and return to Integrations', async () => {
      await web.evaluate(() => {
        window.open = () => null
      })
      await web.getByRole('button', { name: 'Connect account', exact: true }).click()
      await web.getByRole('link', { name: 'Authorize account' }).click()
      await expect(web).toHaveURL(`${origin}/o/fixture-organization/integrations`)
      await expect(web.getByLabel('Account count')).toHaveText('1')
    })
    await check('canceling Slack setup aborts the pending web HTTP request', async () => {
      holdSlackStart = true
      const starts = startSessions.length
      try {
        await web.getByRole('button', { name: 'Connect Slack', exact: true }).click()
        await expect.poll(() => startSessions.length).toBe(starts + 1)
        await web.getByRole('button', { name: 'Cancel Slack request', exact: true }).click()
        await expect.poll(() => canceledSlackRequests).toBe(1)
        await expect(web.getByRole('button', { name: 'Connect Slack', exact: true })).toBeEnabled()
      } finally {
        holdSlackStart = false
      }
    })
    await check(
      'desktop Search preserves pending receipts after inventory failure and allows cancellation/retry',
      async () => {
        const previousOpens = (await opened()).length
        await page.getByRole('button', { name: 'Connect personal Search', exact: true }).click()
        await expect.poll(async () => (await opened()).length).toBe(previousOpens + 1)
        await external.goto((await opened())[previousOpens])
        await external.getByRole('link', { name: 'Authorize personal Search' }).waitFor()
        personalInventoryFailed = true
        await external.getByRole('link', { name: 'Authorize personal Search' }).click()
        await expect(external).toHaveURL(`${origin}/desktop/done?kind=connect`)
        await expect.poll(() => personalInventoryFailures).toBeGreaterThan(0)
        await expect(
          page.getByRole('button', { name: 'Connect personal Search', exact: true })
        ).toBeEnabled()
        const receipt = () =>
          page.evaluate(() => {
            const entry = Object.entries(localStorage).find(([key]) =>
              key.startsWith('sim.search-connection.')
            )
            if (!entry) return null
            const attempt: { completionId: string; status: string; credentialId?: string } =
              JSON.parse(entry[1])
            return attempt
          })
        const pendingReceipt = await receipt()
        expect(pendingReceipt).toMatchObject({ status: 'pending' })
        await page.getByRole('button', { name: 'Connect personal Search', exact: true }).click()
        expect(await receipt()).toEqual(pendingReceipt)
        await page.getByRole('button', { name: 'Cancel personal Search', exact: true }).click()
        await expect
          .poll(receipt)
          .toMatchObject({ completionId: pendingReceipt?.completionId, status: 'failed' })
        personalInventoryFailed = false
        await page.getByRole('button', { name: 'Retry personal inventory', exact: true }).click()
        await page.getByRole('button', { name: 'Connect personal Search', exact: true }).click()
        await expect.poll(async () => (await opened()).length).toBe(previousOpens + 2)
        const retryReceipt = await receipt()
        expect(retryReceipt).toMatchObject({ status: 'pending' })
        expect(retryReceipt?.completionId).not.toBe(pendingReceipt?.completionId)
        await external.goto((await opened())[previousOpens + 1])
        await external.getByRole('link', { name: 'Authorize personal Search' }).click()
        await expect.poll(receipt).toMatchObject({
          completionId: retryReceipt?.completionId,
          status: 'connected',
          credentialId: 'fixture-personal-account',
        })
      }
    )
    await page.screenshot({ path: test.info().outputPath('source-connect-desktop.png') })
  } finally {
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, JSON.stringify({ checks }, null, 2))
    await browser?.close()
    await app?.close()
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
    rmSync(userData, { recursive: true, force: true })
  }
})
