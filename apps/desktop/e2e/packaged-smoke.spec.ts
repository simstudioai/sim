import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FuseV1Options, FuseVersion, getCurrentFuseWire } from '@electron/fuses'
import { expect, test } from '@playwright/test'

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
