import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron, expect, test } from '@playwright/test'
import { getErrorMessage } from '@sim/utils/errors'
import { build } from 'esbuild'

const DESKTOP_DIR = fileURLToPath(new URL('..', import.meta.url))

test('the real MacUpdater waits for native staging, replaces old builds, retries failed staging, and restarts on one click', async () => {
  test.skip(process.platform !== 'darwin', 'Squirrel.Mac lifecycle')
  const directory = mkdtempSync(join(tmpdir(), 'sim-updater-e2e-'))
  const reportPath =
    process.env.DESKTOP_UPDATER_REPORT_PATH ?? test.info().outputPath('updater.json')
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  let offeredVersion = '2.0.0'
  const requests: { path: string; status: number }[] = []
  const checks: {
    name: string
    status: 'passed' | 'failed'
    durationMs: number
    error?: string
  }[] = []
  const check = async (name: string, run: () => Promise<void>) => {
    const started = Date.now()
    try {
      await run()
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
  let snapshot: unknown
  let completed = false
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    requests.push({ path, status: 200 })
    if (path === '/latest-mac.yml') {
      const archive = Buffer.from(offeredVersion)
      response.end(
        `version: ${offeredVersion}\nfiles:\n  - url: Sim-${offeredVersion}-universal.zip\n    sha512: ${createHash('sha512').update(archive).digest('base64')}\n    size: ${archive.length}\n`
      )
    } else {
      response.end(/^\/Sim-(.+)-universal.zip$/.exec(path)?.[1] ?? '')
    }
  })

  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture address')
    mkdirSync(join(directory, 'user-data'))
    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({ name: 'sim-updater-fixture', version: '1.0.0', main: 'main.cjs' })
    )
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
    app = await electron.launch({
      args: [directory, '--use-mock-keychain'],
      env: {
        ...process.env,
        SIM_UPDATER_FIXTURE_DIR: directory,
        SIM_UPDATER_FIXTURE_ORIGIN: `http://127.0.0.1:${address.port}`,
      },
    })
    const shell = app
    const read = () => shell.evaluate(() => globalThis.desktopUpdaterFixture.read())
    await expect
      .poll(() => shell.evaluate(() => Boolean(globalThis.desktopUpdaterFixture)))
      .toBe(true)

    await check('first download waits for native staging', async () => {
      await shell.evaluate(() => globalThis.desktopUpdaterFixture.check())
      await expect.poll(async () => (await read()).nativeArchive).toBe('2.0.0')
      expect((await read()).state).toEqual({
        status: 'downloading',
        version: '2.0.0',
        percent: 100,
      })
      await shell.evaluate(() => globalThis.desktopUpdaterFixture.install())
      expect((await read()).installed).toEqual([])
      await shell.evaluate(() => globalThis.desktopUpdaterFixture.finishStaging())
      expect((await read()).state).toEqual({ status: 'ready', version: '2.0.0' })
    })

    await check('replacement cannot restart into stale native update', async () => {
      offeredVersion = '2.1.0'
      await shell.evaluate(() => globalThis.desktopUpdaterFixture.check())
      await expect.poll(async () => (await read()).nativeArchive).toBe('2.1.0')
      expect((await read()).state).toEqual({
        status: 'downloading',
        version: '2.1.0',
        percent: 100,
      })
      await shell.evaluate(() => globalThis.desktopUpdaterFixture.install())
      expect((await read()).installed).toEqual([])
      await shell.evaluate(() => globalThis.desktopUpdaterFixture.failStaging())
      expect((await read()).state).toEqual({ status: 'error', version: '2.1.0' })
    })

    await check('cached retry stages only the verified replacement', async () => {
      await shell.evaluate(() => globalThis.desktopUpdaterFixture.check())
      await expect
        .poll(async () => (await read()).state)
        .toEqual({ status: 'downloading', version: '2.1.0', percent: 100 })
      await expect.poll(async () => (await read()).nativeArchive).toBe('2.1.0')
      await shell.evaluate(() => globalThis.desktopUpdaterFixture.finishStaging())
      expect((await read()).state).toEqual({ status: 'ready', version: '2.1.0' })
    })

    await check(
      'restart asks only about real in-flight work, then installs on one click',
      async () => {
        /** Sets the work in progress, clicks Restart to update, and answers any prompt with `response`. */
        const installWith = async (
          work: { terminalCommands?: string[]; unloadListener: 'passive' | 'unsaved-edits' },
          response: number
        ) => {
          await shell.evaluate(
            async (_electron, [{ terminalCommands = [], unloadListener }, answer]) => {
              await globalThis.desktopUpdaterFixture.setWork({ terminalCommands, unloadListener })
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

        // Answering Not Now again would leave nothing installed if a prompt appeared.
        await installWith({ unloadListener: 'passive' }, 1)
        await expect.poll(async () => (await read()).installed).toEqual(['2.1.0'])
        expect((await read()).dialogs).toHaveLength(2)
      }
    )
    snapshot = await read()
    await check(
      'the next process distinguishes an incomplete update from a successful install',
      async () => {
        const checkpoint = readFileSync(join(directory, 'update-install.json'), 'utf8')
        await app?.close()
        app = await electron.launch({
          args: [directory, '--use-mock-keychain'],
          env: {
            ...process.env,
            SIM_UPDATER_FIXTURE_DIR: directory,
            SIM_UPDATER_FIXTURE_ORIGIN: `http://127.0.0.1:${address.port}`,
          },
        })
        await expect
          .poll(() => app?.evaluate(() => globalThis.desktopUpdaterFixture?.read().events))
          .toContainEqual({
            name: 'update_install_result',
            data: { expected: '2.1.0', installed: '1.0.0', success: false },
          })
        await app.close()
        writeFileSync(join(directory, 'update-install.json'), checkpoint)
        writeFileSync(
          join(directory, 'package.json'),
          JSON.stringify({ name: 'sim-updater-fixture', version: '2.1.0', main: 'main.cjs' })
        )
        app = await electron.launch({
          args: [directory, '--use-mock-keychain'],
          env: {
            ...process.env,
            SIM_UPDATER_FIXTURE_DIR: directory,
            SIM_UPDATER_FIXTURE_ORIGIN: `http://127.0.0.1:${address.port}`,
          },
        })
        await expect
          .poll(() => app?.evaluate(() => globalThis.desktopUpdaterFixture?.read().events))
          .toContainEqual({
            name: 'update_install_result',
            data: { expected: '2.1.0', installed: '2.1.0', success: true },
          })
      }
    )
    completed = true
  } finally {
    if (!snapshot && app)
      snapshot = await app
        .evaluate(() => globalThis.desktopUpdaterFixture?.read())
        .catch(() => undefined)
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          passed: completed && checks.every((check) => check.status === 'passed'),
          checks,
          requests,
          snapshot,
        },
        null,
        2
      )
    )
    await app?.close()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
})
