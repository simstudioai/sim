import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import { build } from 'esbuild'
import { DESKTOP_DIR, expect, serve, test } from './harness'

test('the real MacUpdater waits for native staging, replaces old builds, retries failed staging, and restarts on one click', async ({
  desktop,
}) => {
  test.skip(process.platform !== 'darwin', 'Squirrel.Mac lifecycle')
  const directory = desktop.tempDir('sim-updater-e2e-')
  let offeredVersion = '2.0.0'
  const fixture = await serve((_request, response, url) => {
    if (url.pathname === '/latest-mac.yml') {
      const archive = Buffer.from(offeredVersion)
      response.end(
        `version: ${offeredVersion}\nfiles:\n  - url: Sim-${offeredVersion}-universal.zip\n    sha512: ${createHash('sha512').update(archive).digest('base64')}\n    size: ${archive.length}\n`
      )
    } else {
      response.end(/^\/Sim-(.+)-universal.zip$/.exec(url.pathname)?.[1] ?? '')
    }
  })
  const writeVersion = (version: string) =>
    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({ name: 'sim-updater-fixture', version, main: 'main.cjs' })
    )
  /** Launches the fixture main, which keeps its profile in `user-data` under the fixture dir. */
  const launch = () =>
    desktop.launch({
      origin: fixture.origin,
      main: directory,
      args: ['--use-mock-keychain'],
      userData: join(directory, 'user-data'),
      env: { SIM_UPDATER_FIXTURE_DIR: directory, SIM_UPDATER_FIXTURE_ORIGIN: fixture.origin },
    })
  const installResults = (app: ElectronApplication) =>
    app.evaluate(() => globalThis.desktopUpdaterFixture?.read().events)

  try {
    mkdirSync(join(directory, 'user-data'))
    writeVersion('1.0.0')
    await build({
      entryPoints: [join(DESKTOP_DIR, 'e2e/fixtures/updater.ts')],
      outfile: join(directory, 'main.cjs'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
      tsconfig: join(DESKTOP_DIR, 'tsconfig.json'),
      plugins: [
        {
          name: 'record-fixture-dialogs',
          setup(builder) {
            builder.onResolve({ filter: /^@\/main\/dialogs$/ }, () => ({
              path: 'dialog',
              namespace: 'fixture',
            }))
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
              contents: `export async function showShellDialog(...args) {
                const { title, message, buttons, defaultId, cancelId } = args.at(-1)
                globalThis.updaterFixtureDialogs.push({ title, message, buttons, defaultId, cancelId })
                return { response: globalThis.updaterFixtureDialogResponse, checkboxChecked: false }
              }`,
            }))
          },
        },
      ],
    })
    const first = await launch()
    const { app } = first
    const read = () => app.evaluate(() => globalThis.desktopUpdaterFixture.read())
    await expect
      .poll(() => app.evaluate(() => Boolean(globalThis.desktopUpdaterFixture)))
      .toBe(true)

    await test.step('first download waits for native staging', async () => {
      await app.evaluate(() => globalThis.desktopUpdaterFixture.check())
      await expect.poll(async () => (await read()).nativeArchive).toBe('2.0.0')
      expect((await read()).state).toEqual({
        status: 'downloading',
        version: '2.0.0',
        percent: 100,
      })
      await app.evaluate(() => globalThis.desktopUpdaterFixture.install())
      expect((await read()).installed).toEqual([])
      await app.evaluate(() => globalThis.desktopUpdaterFixture.finishStaging())
      expect((await read()).state).toEqual({ status: 'ready', version: '2.0.0' })
    })

    await test.step('replacement cannot restart into stale native update', async () => {
      offeredVersion = '2.1.0'
      await app.evaluate(() => globalThis.desktopUpdaterFixture.check())
      await expect.poll(async () => (await read()).nativeArchive).toBe('2.1.0')
      expect((await read()).state).toEqual({
        status: 'downloading',
        version: '2.1.0',
        percent: 100,
      })
      await app.evaluate(() => globalThis.desktopUpdaterFixture.install())
      expect((await read()).installed).toEqual([])
      await app.evaluate(() => globalThis.desktopUpdaterFixture.failStaging())
      expect((await read()).state).toEqual({ status: 'error', version: '2.1.0' })
    })

    await test.step('cached retry stages only the verified replacement', async () => {
      await app.evaluate(() => globalThis.desktopUpdaterFixture.check())
      await expect
        .poll(async () => (await read()).state)
        .toEqual({ status: 'downloading', version: '2.1.0', percent: 100 })
      await expect.poll(async () => (await read()).nativeArchive).toBe('2.1.0')
      await app.evaluate(() => globalThis.desktopUpdaterFixture.finishStaging())
      expect((await read()).state).toEqual({ status: 'ready', version: '2.1.0' })
    })

    await test.step('restart asks only about real in-flight work, then installs on one click', async () => {
      /** Sets the work in progress, clicks Restart to update, and answers any prompt with `response`. */
      const installWith = async (
        work: {
          terminalCommands?: string[]
          browserToolRunning?: boolean
          unloadListener: 'passive' | 'unsaved-edits'
          hungWindow?: boolean
        },
        response: number
      ) => {
        await app.evaluate(
          async (
            _electron,
            [{ terminalCommands = [], browserToolRunning = false, ...rest }, answer]
          ) => {
            await globalThis.desktopUpdaterFixture.setWork({
              terminalCommands,
              browserToolRunning,
              ...rest,
            })
            globalThis.updaterFixtureDialogResponse = answer
            globalThis.desktopUpdaterFixture.install()
          },
          [work, response] as const
        )
      }
      const expectNotNowPrompt = async (count: number, message: string) => {
        await expect.poll(async () => (await read()).dialogs.length).toBe(count)
        expect((await read()).dialogs.at(-1)).toEqual({
          title: 'Restart to install Sim 2.1.0?',
          message,
          buttons: ['Restart and Update', 'Not Now'],
          defaultId: 0,
          cancelId: 1,
        })
        // The decline settles asynchronously; nothing may install, and the update stays ready.
        await expect
          .poll(async () => (await read()).state)
          .toEqual({ status: 'ready', version: '2.1.0' })
        expect((await read()).installed).toEqual([])
      }

      await installWith(
        { terminalCommands: ['cd /repo && claude "fix the build"'], unloadListener: 'passive' },
        1
      )
      await expectNotNowPrompt(1, 'claude is still running in a terminal.')

      await installWith({ unloadListener: 'unsaved-edits' }, 1)
      await expectNotNowPrompt(2, 'A window has unsaved changes.')

      await installWith(
        { browserToolRunning: true, unloadListener: 'passive', hungWindow: true },
        1
      )
      await expectNotNowPrompt(
        3,
        "An agent is using the browser. A window isn't responding and may have unsaved changes."
      )

      // Answering Not Now again would leave nothing installed if a prompt appeared.
      await installWith({ unloadListener: 'passive' }, 1)
      await expect.poll(async () => (await read()).installed).toEqual(['2.1.0'])
      expect((await read()).dialogs).toHaveLength(3)
    })
    await test.step('the next process distinguishes an incomplete update from a successful install', async () => {
      const checkpoint = readFileSync(join(directory, 'update-install.json'), 'utf8')
      await desktop.close(first)
      const stale = await launch()
      await expect
        .poll(() => installResults(stale.app))
        .toContainEqual({
          name: 'update_install_result',
          data: { expected: '2.1.0', installed: '1.0.0', success: false },
        })
      await desktop.close(stale)
      writeFileSync(join(directory, 'update-install.json'), checkpoint)
      writeVersion('2.1.0')
      const updated = await launch()
      await expect
        .poll(() => installResults(updated.app))
        .toContainEqual({
          name: 'update_install_result',
          data: { expected: '2.1.0', installed: '2.1.0', success: true },
        })
    })
  } finally {
    await fixture.close()
  }
})
