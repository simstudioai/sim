/**
 * Shared launch and teardown for the Electron E2E suite.
 *
 * Every spec launches the app through the `desktop` fixture, which tracks each app and temp
 * directory a test creates and tears all of them down, even when the test fails midway. Closing is
 * bounded: `ElectronApplication.close()` asks the app to quit and then waits for the process with
 * no deadline, so a quit that a dialog or a cancelled `before-quit` blocks used to hang a test to
 * its timeout and then hang the worker's own teardown. A quit that misses its deadline is a real
 * bug (it is the same path as Cmd+Q), so the fixture records what the app was doing, kills it, and
 * fails the test rather than hiding the stall.
 */
import { type ChildProcess, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  test as base,
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  type TestInfo,
} from '@playwright/test'
import type { BrowserToolName } from '@sim/browser-protocol'
import type { SimDesktopApi } from '@sim/desktop-bridge'
import { type BuildOptions, build } from 'esbuild'
import postcss from 'postcss'
import loadPostcssConfig from 'postcss-load-config'

export { expect }

export const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))
export const SIM_DIR = fileURLToPath(new URL('../../sim/', import.meta.url))

/** Above the 5s an account teardown may legitimately hold `before-quit`. */
const QUIT_DEADLINE_MS = 15_000
const OUTPUT_TAIL_BYTES = 64 * 1024

export type DesktopBridge = typeof globalThis & { simDesktop: SimDesktopApi }

export interface LaunchOptions {
  origin: string
  /** A profile to reuse, e.g. to relaunch on the same one. Defaults to a fresh temp profile. */
  userData?: string
  /** Written to the profile's `settings.json` before launch; a string is written verbatim. */
  settings?: unknown
  env?: Record<string, string>
  /** The app directory or main script. */
  main?: string
  args?: string[]
  /**
   * Keeps Playwright from auto-dismissing page dialogs, so the desktop's own dialog handling
   * decides them as it does in production.
   */
  leaveDialogsToDesktop?: boolean
}

export interface DesktopApp {
  app: ElectronApplication
  userData: string
  /** The tail of the main process's stdout and stderr. */
  output(): string
}

export interface DesktopFixture {
  launch(options: LaunchOptions): Promise<DesktopApp>
  /** Quits an app mid-test, under the same deadline as teardown. */
  close(desktop: DesktopApp): Promise<void>
  /** A temp directory removed after the test. */
  tempDir(prefix: string): string
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

function captureOutput(child: ChildProcess): () => string {
  let tail = ''
  const append = (chunk: Buffer) => {
    tail = (tail + chunk.toString('utf8')).slice(-OUTPUT_TAIL_BYTES)
  }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  return () => tail
}

/** Everything that says why an app did not quit, gathered before it is killed. */
async function quitStallDiagnostics(desktop: DesktopApp): Promise<string> {
  const pid = desktop.app.process().pid
  const sections: string[] = []
  const windows = await Promise.race([
    desktop.app
      .evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((win) => ({
          title: win.getTitle(),
          url: win.webContents.getURL(),
          visible: win.isVisible(),
        }))
      )
      .then((list) => JSON.stringify(list, null, 2)),
    new Promise<string>((resolve) =>
      setTimeout(
        () => resolve('main process did not answer within 2s (its thread is blocked)'),
        2_000
      )
    ),
  ]).catch((error: unknown) => `could not list windows: ${String(error)}`)
  sections.push(`## Windows\n${windows}`)
  if (process.platform === 'darwin' && pid !== undefined) {
    try {
      const stack = execFileSync('sample', [String(pid), '2'], {
        encoding: 'utf8',
        timeout: 15_000,
      })
      sections.push(`## Main process sample\n${stack}`)
    } catch (error) {
      sections.push(`## Main process sample\nunavailable: ${String(error)}`)
    }
  }
  sections.push(`## Main process output (tail)\n${desktop.output()}`)
  try {
    const log = readFileSync(join(desktop.userData, 'logs', 'desktop-events.log'), 'utf8')
    sections.push(`## desktop-events.log (tail)\n${log.slice(-OUTPUT_TAIL_BYTES)}`)
  } catch {
    sections.push('## desktop-events.log\nnone')
  }
  return sections.join('\n\n')
}

/**
 * The processes that can still write a profile: Chromium's helpers stay in the app's process group
 * (Playwright spawns it detached, so the group is its own), while Crashpad's handler starts its own
 * session but names the profile on its command line.
 */
function profileWriters(appGroup: number, profilePaths: readonly string[]): number[] {
  return execFileSync('ps', ['-axww', '-o', 'pid=,pgid=,command='], { encoding: 'utf8' })
    .split('\n')
    .flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
      if (!match) return []
      const [, pid, group, command] = match
      return Number(group) === appGroup || profilePaths.some((path) => command.includes(path))
        ? [Number(pid)]
        : []
    })
}

/**
 * Kills whatever is left of an app and removes its profile once nothing can write to it: a helper
 * or Crashpad's handler creating a file mid-removal fails it with ENOTEMPTY.
 */
export async function stopAndRemoveProfile(child: ChildProcess, userData: string): Promise<void> {
  if (!hasExited(child)) {
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
  }
  if (child.pid !== undefined) {
    const appGroup = child.pid
    let profilePaths = [userData]
    try {
      profilePaths = [userData, realpathSync(userData)]
    } catch {}
    await expect
      .poll(() => {
        const writers = profileWriters(appGroup, profilePaths)
        for (const pid of writers) {
          try {
            process.kill(pid, 'SIGKILL')
          } catch {}
        }
        return writers
      })
      .toEqual([])
  }
  rmSync(userData, { recursive: true, force: true })
}

/**
 * Quits an app through Playwright (the same `app.quit()` path as Cmd+Q). If it has not exited by
 * the deadline, attaches what it was doing, kills it, and throws.
 */
async function closeDesktop(desktop: DesktopApp, testInfo: TestInfo): Promise<void> {
  const child = desktop.app.process()
  if (hasExited(child)) return
  const exited = once(child, 'exit')
  // The exit event is the outcome; close() itself rejects once the process is gone.
  void desktop.app.close().catch(() => {})
  let timer: NodeJS.Timeout | undefined
  const quit = await Promise.race([
    exited.then(() => true),
    new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), QUIT_DEADLINE_MS)
    }),
  ])
  clearTimeout(timer)
  if (quit) return
  const diagnostics = await quitStallDiagnostics(desktop)
  await testInfo.attach('electron-quit-stall', { body: diagnostics, contentType: 'text/plain' })
  if (!hasExited(child) && child.pid !== undefined) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
    await exited
  }
  throw new Error(
    `Electron did not quit within ${QUIT_DEADLINE_MS / 1_000}s; see the electron-quit-stall attachment`
  )
}

export const test = base.extend<{ desktop: DesktopFixture }>({
  desktop: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from this destructuring, and this one has none.
    async ({}, use, testInfo) => {
      const launched: DesktopApp[] = []
      const tempDirs: string[] = []
      const tempDir = (prefix: string) => {
        const dir = mkdtempSync(join(tmpdir(), prefix))
        tempDirs.push(dir)
        return dir
      }
      await use({
        tempDir,
        async launch(options) {
          const userData = options.userData ?? tempDir('sim-desktop-e2e-profile-')
          if (options.settings !== undefined) {
            writeFileSync(
              join(userData, 'settings.json'),
              typeof options.settings === 'string'
                ? options.settings
                : JSON.stringify(options.settings)
            )
          }
          const app = await electron.launch({
            args: [options.main ?? '.', ...(options.args ?? [])],
            cwd: DESKTOP_DIR,
            env: {
              ...process.env,
              SIM_DESKTOP_ORIGIN: options.origin,
              SIM_DESKTOP_USER_DATA: userData,
              ...options.env,
            },
          })
          const desktop: DesktopApp = { app, userData, output: captureOutput(app.process()) }
          launched.push(desktop)
          if (options.leaveDialogsToDesktop) {
            const leave = (page: Page) => page.on('dialog', () => {})
            app.context().pages().forEach(leave)
            app.context().on('page', leave)
          }
          return desktop
        },
        close: (desktop) => closeDesktop(desktop, testInfo),
      })
      // Every app is closed and every directory removed even if an earlier one fails; the first
      // failure is reported once the rest are cleaned up.
      const failures: unknown[] = []
      for (const desktop of launched) {
        try {
          await closeDesktop(desktop, testInfo)
        } catch (error) {
          failures.push(error)
        }
      }
      for (const desktop of launched) {
        try {
          await stopAndRemoveProfile(desktop.app.process(), desktop.userData)
        } catch (error) {
          failures.push(error)
        }
      }
      for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
      if (failures.length > 0) throw failures[0]
    },
    // Teardown has its own budget, so a test that used up its time still gets cleaned up.
    { timeout: 2 * QUIT_DEADLINE_MS + 30_000 },
  ],
})

export type FixtureHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
) => void | Promise<void>

export interface FixtureServer {
  server: Server
  /** `http://127.0.0.1:<port>`. */
  origin: string
  /** The same server as `http://localhost:<port>`, a different site for cross-site checks. */
  site: string
  close(): Promise<void>
}

/** An HTTP fixture on loopback only, closed with its open connections. */
export async function serve(handler: FixtureHandler): Promise<FixtureServer> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    Promise.resolve(handler(request, response, url)).catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(500)
      response.end(String(error))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    server,
    origin: `http://127.0.0.1:${port}`,
    site: `http://localhost:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
  }
}

/** Brings the app's first window to the front and waits until the OS reports it focused. */
export async function focusFirstWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app, BrowserWindow }) => {
    const host = BrowserWindow.getAllWindows()[0]
    host.webContents.setBackgroundThrottling(false)
    app.focus({ steal: true })
    host.focus()
  })
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()))
    .toBe(true)
}

/**
 * Activates a browser scope in the shell page and keeps the native browser panel below a `top`
 * inset, following window resizes. Resolves once the bounds reached the main process.
 */
export async function attachBrowserPanel(shell: Page, scope: string, top = 80): Promise<void> {
  await shell.evaluate(
    async ({ scope, top }) => {
      const api = (globalThis as DesktopBridge).simDesktop
      await api.browserAgent.activateScope(scope)
      const updateBounds = () =>
        api.browserAgent.setPanelBounds(
          { x: 0, y: top, width: innerWidth, height: innerHeight - top },
          null,
          scope
        )
      updateBounds()
      addEventListener('resize', updateBounds)
      // One renderer's IPC is handled in order, so this round trip lands after the bounds.
      await api.browserAgent.activateScope(scope)
    },
    { scope, top }
  )
}

export interface SimFixtureBundle {
  js: string
  css: string
}

/**
 * Bundles a browser fixture built from apps/sim source, with apps/sim's stylesheet, so a spec can
 * serve real Sim UI from its fixture server. `entry` is either a file or inline TSX resolved from
 * apps/sim.
 */
export async function bundleSimFixture(
  entry: { file: string } | { source: string },
  options: Pick<BuildOptions, 'inject' | 'external'> = {}
): Promise<SimFixtureBundle> {
  const bundle = await build({
    ...('file' in entry
      ? { entryPoints: [entry.file] }
      : { stdin: { contents: entry.source, resolveDir: SIM_DIR, loader: 'tsx' } }),
    bundle: true,
    write: false,
    outdir: 'out',
    jsx: 'automatic',
    external: ['node:async_hooks', ...(options.external ?? [])],
    inject: options.inject,
    banner: { js: 'var process={env:{NODE_ENV:"development"},browser:true};' },
    format: 'iife',
    platform: 'browser',
    tsconfig: join(SIM_DIR, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"development"' },
  })
  const js = bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.text
  if (js === undefined) throw new Error('The fixture bundle produced no JavaScript')
  const config = await loadPostcssConfig({}, SIM_DIR)
  const stylesheet = join(SIM_DIR, 'app/_styles/globals.css')
  const css = await postcss(config.plugins).process(readFileSync(stylesheet, 'utf8'), {
    from: stylesheet,
  })
  return { js, css: css.css }
}

export interface ToolCallAuthorization {
  chatId: string
  toolName: string
  args: unknown
}

/**
 * Stands in for Sim's `/api/desktop/tool/authorize`: the desktop asks it before running a tool
 * call, and it authorizes exactly the calls a test issued.
 */
export class ToolAuthorizer {
  readonly calls = new Map<string, ToolCallAuthorization>()
  private count = 0

  constructor(private readonly prefix: string) {}

  /** Handles the authorize route; returns false for any other path. */
  async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    if (url.pathname !== '/api/desktop/tool/authorize') return false
    let body = ''
    for await (const chunk of request) body += chunk.toString()
    const authorization = this.calls.get(JSON.parse(body).toolCallId)
    response.writeHead(authorization ? 200 : 403, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(authorization ?? {}))
    return true
  }

  /** Authorizes a new browser tool call and returns its id. */
  issue(scope: string, toolName: BrowserToolName, args: unknown): string {
    const callId = `${this.prefix}-${++this.count}`
    this.calls.set(callId, { chatId: scope, toolName, args })
    return callId
  }

  /** Runs a browser tool from the shell page and returns its result, failing on a tool error. */
  async execute(
    shell: Page,
    scope: string,
    toolName: BrowserToolName,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const callId = this.issue(scope, toolName, args)
    const result = await shell.evaluate(
      ({ callId, toolName, args, scope }) =>
        (globalThis as DesktopBridge).simDesktop.browserAgent.executeTool(
          callId,
          toolName,
          args,
          scope
        ),
      { callId, toolName, args, scope }
    )
    expect(result.ok, result.error).toBe(true)
    return result.result
  }
}
