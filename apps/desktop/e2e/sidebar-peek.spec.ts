import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test } from '@playwright/test'
import { getErrorMessage } from '@sim/utils/errors'
import { build } from 'esbuild'
import postcss from 'postcss'
import loadPostcssConfig from 'postcss-load-config'

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))
const SIM_DIR = fileURLToPath(new URL('../../sim/', import.meta.url))
const FIXTURE = fileURLToPath(
  new URL('../../sim/scripts/fixtures/sidebar-peek.tsx', import.meta.url)
)

/**
 * The hover peek only exists on the macOS shell, whose title-bar lane comes from the real bridge.
 * The production `WorkspaceChrome` runs in real Electron; only the rail inside it is a stand-in, and
 * the chat plan modal it mounts is stubbed so the fixture does not bundle the whole Home surface.
 */
test('hover peek floats the collapsed rail, retracts, and a click docks it', async () => {
  test.skip(process.platform !== 'darwin', 'The title-bar lane and peek are macOS only')
  const reportPath =
    process.env.SIDEBAR_PEEK_REPORT_PATH ?? test.info().outputPath('sidebar-peek.json')
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
  const userData = mkdtempSync(join(tmpdir(), 'sim-sidebar-peek-e2e-'))
  const errors: string[] = []
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  let javascript = ''
  let stylesheet = ''
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    if (path === '/fixture.js' || path === '/fixture.css') {
      response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css')
      response.end(path.endsWith('.js') ? javascript : stylesheet)
    } else if (path.startsWith('/api/')) {
      response.setHeader('Content-Type', 'application/json')
      response.end(
        path === '/api/auth/get-session'
          ? JSON.stringify({ user: { id: 'fixture-user' }, session: { id: 'fixture-session' } })
          : '{}'
      )
    } else {
      response.setHeader('Content-Type', 'text/html')
      response.setHeader('Set-Cookie', [
        'better-auth.session_token=fixture; HttpOnly; SameSite=Lax; Path=/',
        'sidebar_collapsed=1; SameSite=Lax; Path=/',
      ])
      response.end(
        '<!doctype html><html class="dark"><head><link rel="stylesheet" href="/fixture.css"></head><body style="margin:0;background:var(--bg);color:var(--text-primary)"><div id="root"></div><script src="/fixture.js"></script></body></html>'
      )
    }
  })

  try {
    await check('load the production workspace chrome in Electron', async () => {
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
        external: ['node:async_hooks'],
        banner: { js: 'var process={env:{NODE_ENV:"development"},browser:true};' },
        format: 'iife',
        platform: 'browser',
        tsconfig: join(SIM_DIR, 'tsconfig.json'),
        define: { 'process.env.NODE_ENV': '"development"' },
        plugins: [
          {
            name: 'stub-chat-plan-modal',
            setup(pluginBuild) {
              pluginBuild.onResolve({ filter: /home\/components\/chat-plan-modal$/ }, (args) => ({
                path: args.path,
                namespace: 'chat-plan-modal-stub',
              }))
              pluginBuild.onLoad({ filter: /.*/, namespace: 'chat-plan-modal-stub' }, () => ({
                contents: 'export function ChatPlanModal() { return null }',
                loader: 'js',
              }))
            },
          },
        ],
      })
      javascript = bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? ''
      stylesheet = `${css.css}\n${bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? ''}`
      await new Promise<void>((resolve) => server.listen(0, resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing fixture address')
      app = await electron.launch({
        args: [process.env.SIM_DESKTOP_E2E_MAIN ?? '.'],
        cwd: DESKTOP_DIR,
        env: {
          ...process.env,
          SIM_DESKTOP_ORIGIN: `http://127.0.0.1:${address.port}`,
          SIM_DESKTOP_USER_DATA: userData,
        },
      })
    })
    if (!app) throw new Error('Electron did not launch')
    const page = await app.firstWindow()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.reload()
    const expanded = page.getByRole('navigation', { name: 'Expanded rail' })
    const trigger = page.getByRole('button', { name: 'Expand sidebar', exact: true })

    await check('the shell puts the chrome in its inset title-bar lane, collapsed', async () => {
      await expect(page.locator('html[data-sim-desktop-title-bar="inset"]')).toHaveCount(1)
      await expect(page.getByRole('complementary', { name: 'Fixture rail' })).toBeAttached()
      await expect(expanded).toHaveCount(0)
    })
    await check('hovering the title-bar toggle floats the rail', async () => {
      await trigger.hover()
      await expect(expanded).toBeVisible()
    })
    await check('moving the pointer inside the card keeps it, leaving retracts it', async () => {
      const box = await expanded.boundingBox()
      if (!box) throw new Error('The card has no box')
      await page.mouse.move(box.x + 4, box.y + 4, { steps: 6 })
      await expect(expanded).toBeVisible()
      await page.mouse.move(600, 400, { steps: 8 })
      await expect(expanded).toHaveCount(0)
    })
    await check('Escape retracts it', async () => {
      await trigger.hover()
      await expect(expanded).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(expanded).toHaveCount(0)
    })
    await check('a click docks the rail, and it stays with the pointer gone', async () => {
      await page.mouse.move(600, 400, { steps: 2 })
      await trigger.click()
      await expect(
        page.getByRole('button', { name: 'Collapse sidebar', exact: true })
      ).toBeVisible()
      await page.mouse.move(600, 400, { steps: 8 })
      await expect(expanded).toBeVisible()
    })
    expect(errors).toEqual([])
  } finally {
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, JSON.stringify({ checks, errors }, null, 2))
    await app?.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(userData, { recursive: true, force: true })
  }
})
