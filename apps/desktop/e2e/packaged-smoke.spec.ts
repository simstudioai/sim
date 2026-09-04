import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FuseV1Options, FuseVersion, getCurrentFuseWire } from '@electron/fuses'
import { type Browser, chromium, expect, test } from '@playwright/test'

const FUSE_DISABLED = '0'.charCodeAt(0)
const FUSE_ENABLED = '1'.charCodeAt(0)
const ELECTRON_43_WASM_TRAP_HANDLERS_FUSE = 8

const EXPECTED_FUSE_POLICY = [
  [FuseV1Options.RunAsNode, FUSE_DISABLED],
  [FuseV1Options.EnableCookieEncryption, FUSE_ENABLED],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FUSE_DISABLED],
  [FuseV1Options.EnableNodeCliInspectArguments, FUSE_DISABLED],
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FUSE_ENABLED],
  [FuseV1Options.OnlyLoadAppFromAsar, FUSE_ENABLED],
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot, FUSE_DISABLED],
  [FuseV1Options.GrantFileProtocolExtraPrivileges, FUSE_DISABLED],
  [ELECTRON_43_WASM_TRAP_HANDLERS_FUSE, FUSE_ENABLED],
] as const

test.skip(
  !process.env.SIM_DESKTOP_EXECUTABLE,
  'Packaged smoke runs only after the desktop executable has been built'
)

test('packaged Electron binary has the production fuse policy', async () => {
  const executablePath = process.env.SIM_DESKTOP_EXECUTABLE
  if (!executablePath) throw new Error('SIM_DESKTOP_EXECUTABLE is required')

  const fuses = await getCurrentFuseWire(executablePath)
  expect(fuses.version).toBe(FuseVersion.V1)
  const fuseIndexes = Object.keys(fuses)
    .filter((key) => /^\d+$/.test(key))
    .map(Number)

  expect(fuseIndexes).toEqual(EXPECTED_FUSE_POLICY.map(([index]) => index))
  for (const [index, state] of EXPECTED_FUSE_POLICY) {
    expect(Reflect.get(fuses, index)).toBe(state)
  }
})

test('packaged main process starts and records launch telemetry', async () => {
  const executablePath = process.env.SIM_DESKTOP_EXECUTABLE
  if (!executablePath) throw new Error('SIM_DESKTOP_EXECUTABLE is required')
  const userDataPath = mkdtempSync(join(tmpdir(), 'sim-desktop-packaged-e2e-'))
  const child = spawn(executablePath, [], {
    env: {
      ...process.env,
      SIM_DESKTOP_ORIGIN: 'http://127.0.0.1:1',
      SIM_DESKTOP_USER_DATA: userDataPath,
    },
    stdio: 'ignore',
  })
  const eventLogPath = join(userDataPath, 'logs', 'desktop-events.log')

  try {
    await expect
      .poll(
        () => {
          if (child.exitCode !== null || child.signalCode !== null) {
            throw new Error(
              `Packaged app exited with ${child.exitCode ?? child.signalCode ?? 'unknown status'}`
            )
          }
          return (
            existsSync(eventLogPath) && readFileSync(eventLogPath, 'utf8').includes('app_launch')
          )
        },
        { timeout: 10_000 }
      )
      .toBe(true)
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
    }
    rmSync(userDataPath, { recursive: true, force: true })
  }
})

// The unpackaged suite cannot see this: the bundled pages live inside app.asar
// only once packaged, and the file-protocol fuse is only off once packaged.
// v0.8.13 through v0.8.19 shipped both pages blank because nothing loaded them
// in that configuration. Chromium's remote-debugging switch is honoured by the
// fused binary, which is what lets the test read the rendered page.
test('packaged shell renders the bundled offline page', async () => {
  const executablePath = process.env.SIM_DESKTOP_EXECUTABLE
  if (!executablePath) throw new Error('SIM_DESKTOP_EXECUTABLE is required')
  const userDataPath = mkdtempSync(join(tmpdir(), 'sim-desktop-packaged-e2e-'))
  // Cookie encryption and safeStorage key their secret off the app's identity
  // in the login keychain. A build under test (unsigned locally, or the first
  // run on a machine that already has the real app's item) would block on a
  // Keychain prompt on its main thread, and the debugging endpoint with it.
  const child = spawn(executablePath, ['--remote-debugging-port=0', '--use-mock-keychain'], {
    env: {
      ...process.env,
      SIM_DESKTOP_ORIGIN: 'http://127.0.0.1:1',
      SIM_DESKTOP_USER_DATA: userDataPath,
    },
    stdio: 'ignore',
  })
  const portFile = join(userDataPath, 'DevToolsActivePort')
  let browser: Browser | undefined

  try {
    await expect
      .poll(
        () => {
          if (child.exitCode !== null || child.signalCode !== null) {
            throw new Error(
              `Packaged app exited with ${child.exitCode ?? child.signalCode ?? 'unknown status'}`
            )
          }
          return existsSync(portFile) && readFileSync(portFile, 'utf8').trim().length > 0
        },
        { timeout: 15_000 }
      )
      .toBe(true)
    const port = Number(readFileSync(portFile, 'utf8').split('\n')[0])
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const findPage = (urlPrefix: string) =>
      browser
        ?.contexts()
        .flatMap((context) => context.pages())
        .find((page) => page.url().startsWith(urlPrefix))
    await expect
      .poll(() => Boolean(findPage('sim-shell://pages/offline.html?')), { timeout: 15_000 })
      .toBe(true)
    const offline = findPage('sim-shell://pages/offline.html?')
    if (!offline) throw new Error('offline page disappeared')
    await expect(offline.locator('#title')).toHaveText('Can’t connect to Sim')
    await expect(offline.locator('#server')).toBeVisible()

    // The picker is the recovery path from here. Opening it and reading the
    // pre-filled value crosses the local-page IPC gate twice, which packaged
    // builds also used to refuse: the allowlist was resolved against a working
    // directory that is `/` when Finder launches the app.
    await offline.locator('#server').click()
    await expect
      .poll(() => Boolean(findPage('sim-shell://pages/server.html')), { timeout: 15_000 })
      .toBe(true)
    const picker = findPage('sim-shell://pages/server.html')
    if (!picker) throw new Error('server picker disappeared')
    await expect(picker.locator('h1')).toHaveText('Sim server')
    await expect(picker.locator('#origin')).toHaveValue('http://127.0.0.1:1')
  } finally {
    await browser?.close().catch(() => {})
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
    }
    rmSync(userDataPath, { recursive: true, force: true })
  }
})
