import { type ChildProcess, spawn } from 'node:child_process'
import { expect, test } from '@playwright/test'

/**
 * Starts the zone's real production build as its own process, the way a container does, under the
 * base path it was built with. `instrumentation.ts` runs `assertDeployableMode` and exits when that
 * throws. A second zone, because the first must keep serving the suite before this. The message
 * arrives through the logger, whose JSON output escapes its quotes.
 */
const PORT = 3035
const ORIGIN = `http://127.0.0.1:${PORT}`
/** Only its presence decides the mode; nothing this suite requests reads it. */
const DATABASE = 'postgresql://127.0.0.1:5432/sim'

let running: ChildProcess | undefined

function startZone(env: Record<string, string>) {
  const output: string[] = []
  const zone = spawn(
    'node',
    [
      '../../node_modules/next/dist/bin/next',
      'start',
      'platform',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(PORT),
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DATABASE_URL: undefined,
        SIM_PLATFORM_FIXTURES: undefined,
        SIM_PLATFORM_BASE_PATH: '/org',
        ...env,
      },
    }
  )
  running = zone
  zone.stdout.on('data', (chunk) => output.push(String(chunk)))
  zone.stderr.on('data', (chunk) => output.push(String(chunk)))
  const exitCode = new Promise<number | null>((resolve) => {
    zone.once('exit', (code) => resolve(code))
  })
  return { exitCode, output }
}

test.afterEach(async () => {
  const zone = running
  running = undefined
  if (!zone || zone.exitCode !== null) return
  const exited = new Promise((resolve) => zone.once('exit', resolve))
  zone.kill('SIGTERM')
  await exited
})

test('a production zone with no database refuses to start', async () => {
  const { exitCode, output } = startZone({})
  expect(await exitCode).toBe(1)
  expect(output.join('')).toMatch(/its data mode is \\?"none\\?"/)
})

test('a production zone on fixtures refuses to start', async () => {
  const { exitCode, output } = startZone({
    DATABASE_URL: DATABASE,
    SIM_PLATFORM_FIXTURES: '1',
  })
  expect(await exitCode).toBe(1)
  expect(output.join('')).toMatch(/its data mode is \\?"fixture\\?"/)
})

test('a production zone with a database starts under the same command', async () => {
  const { output } = startZone({ DATABASE_URL: DATABASE })
  await expect
    .poll(
      async () => {
        try {
          // No route answers this, so the zone renders its own not-found page.
          return (await fetch(`${ORIGIN}/org/__availability`)).status
        } catch {
          return 'not listening yet'
        }
      },
      { timeout: 60_000 }
    )
    .toBe(404)
  expect(output.join('')).not.toContain('its data mode is')
})
