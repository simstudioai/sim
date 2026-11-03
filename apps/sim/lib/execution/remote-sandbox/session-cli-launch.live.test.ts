/**
 * Launch-time CLI verification against a real E2B workbench: a command starts only while the
 * deployment CLI still matches, the check resists the user's shell and Python hooks, a refused
 * launch starts nothing, and a repaired CLI launches again.
 *
 * Enable with `SANDBOX_SESSION_SMOKE=1`. Requires `E2B_API_KEY` and `MOTHERSHIP_E2B_TEMPLATE_ID`.
 * Writes a JSON report of each check to `SESSION_CLI_LAUNCH_REPORT_PATH` when set. Creates one
 * short-lived sandbox and always kills it.
 */
import { writeFile } from 'node:fs/promises'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { afterAll, describe, expect, it } from 'vitest'
import { e2bProvider } from '@/lib/execution/remote-sandbox/e2b'
import {
  ensureSessionCli,
  SESSION_CLI_CHECK_SCRIPT,
  SessionCliStaleError,
  sessionCliVerification,
} from '@/lib/execution/remote-sandbox/session-cli'
import type { SandboxHandle, SandboxSessionRequest } from '@/lib/execution/remote-sandbox/types'

const smokeEnabled = process.env.SANDBOX_SESSION_SMOKE === '1'
const TIMEOUT_MS = 30_000
const SAMPLES = 7

interface CheckReport {
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  detail?: unknown
}
const report: CheckReport[] = []

async function check<T>(name: string, run: () => Promise<T>): Promise<T> {
  const startedAt = performance.now()
  try {
    const detail = await run()
    report.push({ name, status: 'passed', durationMs: performance.now() - startedAt, detail })
    return detail
  } catch (error) {
    report.push({
      name,
      status: 'failed',
      durationMs: performance.now() - startedAt,
      detail: getErrorMessage(error),
    })
    throw error
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return Math.round(sorted[Math.floor(sorted.length / 2)])
}

afterAll(async () => {
  const path = process.env.SESSION_CLI_LAUNCH_REPORT_PATH
  if (smokeEnabled && path) await writeFile(path, JSON.stringify(report, null, 2))
})

describe.skipIf(!smokeEnabled)('session CLI verification at launch', () => {
  it(
    'starts a command only while the deployment CLI matches its release',
    async () => {
      const directory = `/home/user/.sim-cli/live-${generateShortId(10)}`
      const cli: NonNullable<SandboxSessionRequest['cli']> = {
        path: `${directory}/cli.mjs`,
        content: 'console.log("cli")\n',
        runtime: { path: `${directory}/runtime.mjs`, content: 'export const runtime = 1\n' },
      }
      const verifyCli = sessionCliVerification(cli)
      const sandbox: SandboxHandle = await e2bProvider.create('mothership', {
        sessionKey: `mothership-chat:live-cli-${generateShortId(10)}`,
        lifetimeMs: 10 * 60_000,
      })
      const run = (command: string, verify = true) =>
        sandbox.runCommand(command, {
          timeoutMs: TIMEOUT_MS,
          atMostOnce: true,
          rootUser: false,
          ...(verify ? { verifyCli } : {}),
        })
      const ranMarker = async (marker: string) =>
        (await run(`test -e /tmp/${marker} && echo yes || echo no`, false)).stdout.trim()
      const expectRefused = async (marker: string) => {
        await expect(run(`touch /tmp/${marker}`)).rejects.toBeInstanceOf(SessionCliStaleError)
        expect(await ranMarker(marker)).toBe('no')
      }
      try {
        expect(sandbox.verifiesCliAtLaunch).toBe(true)
        await check('install CLI', () =>
          ensureSessionCli(sandbox, cli, AbortSignal.timeout(TIMEOUT_MS), TIMEOUT_MS)
        )

        await check('verified launch runs the command as the user', async () => {
          const result = await run(`id -un; test -L ${directory}/sim && echo linked`)
          expect(result.exitCode).toBe(0)
          expect(result.stdout).toContain('user')
          expect(result.stdout).toContain('linked')
          return result.stdout.trim()
        })

        await check('warm-call cost: separate check + launch vs verified launch', async () => {
          const separate: number[] = []
          const merged: number[] = []
          const unverified: number[] = []
          for (let sample = 0; sample < SAMPLES; sample += 1) {
            let startedAt = performance.now()
            await run('true', false)
            unverified.push(performance.now() - startedAt)
            startedAt = performance.now()
            await ensureSessionCli(sandbox, cli, AbortSignal.timeout(TIMEOUT_MS), TIMEOUT_MS)
            await run('true', false)
            separate.push(performance.now() - startedAt)
            startedAt = performance.now()
            await run('true')
            merged.push(performance.now() - startedAt)
          }
          const result = {
            separateMedianMs: median(separate),
            mergedMedianMs: median(merged),
            unverifiedLaunchMedianMs: median(unverified),
          }
          return result
        })

        await check('a modified CLI refuses the launch and starts nothing', async () => {
          await run(`echo 'tampered' >> ${cli.path}`, false)
          await expectRefused('ran-after-edit')
        })

        await check('the user shell and Python hooks cannot fake the check', async () => {
          await run(
            [
              'cp -a ~/.profile /tmp/profile.bak 2>/dev/null || true',
              `printf 'python3() { return 0; }\\n' >> ~/.profile`,
              'site=$(/usr/bin/env python3 -c "import site; print(site.getusersitepackages())")',
              'mkdir -p "$site"',
              `printf 'import sys; sys.exit(0)\\n' > "$site/sim-live.pth"`,
              'echo "$site" > /tmp/sim-live-site',
            ].join('\n'),
            false
          )
          try {
            await expectRefused('ran-after-hooks')
            const shellCheck = await sandbox.runCommand(
              `python3 - <<'SIM_SESSION_CLI'\n${SESSION_CLI_CHECK_SCRIPT}SIM_SESSION_CLI`,
              {
                timeoutMs: TIMEOUT_MS,
                atMostOnce: true,
                rootUser: false,
                envs: {
                  SIM_CLI_PATH: verifyCli.path,
                  SIM_CLI_ARTIFACTS: JSON.stringify(verifyCli.artifacts),
                },
              }
            )
            await expect(
              ensureSessionCli(sandbox, cli, AbortSignal.timeout(TIMEOUT_MS), TIMEOUT_MS)
            ).rejects.toThrow('could not be verified')
            await expectRefused('ran-after-hooked-repair')
            return {
              loginShellCheck:
                shellCheck.exitCode === 0 ? 'passed a tampered CLI' : 'refused a tampered CLI',
            }
          } finally {
            await run(
              'rm -f "$(cat /tmp/sim-live-site)/sim-live.pth"; if [ -e /tmp/profile.bak ]; then cp -a /tmp/profile.bak ~/.profile; else rm -f ~/.profile; fi',
              false
            )
          }
        })

        await check('once the hooks are gone, repair restores the CLI', async () => {
          await ensureSessionCli(sandbox, cli, AbortSignal.timeout(TIMEOUT_MS), TIMEOUT_MS)
          expect((await run(`grep -c tampered ${cli.path} || true`, false)).stdout.trim()).toBe('0')
          expect((await run('echo ok')).stdout.trim()).toBe('ok')
        })

        await check('a symlinked artifact refuses the launch', async () => {
          await ensureSessionCli(sandbox, cli, AbortSignal.timeout(TIMEOUT_MS), TIMEOUT_MS)
          await run(`rm -f ${cli.path} && ln -s /etc/hostname ${cli.path}`, false)
          await expectRefused('ran-after-symlink')
        })

        await check('a missing runtime refuses the launch', async () => {
          await run(`rm -f ${cli.path} ${cli.runtime?.path}`, false)
          await expectRefused('ran-after-delete')
        })

        await check('an unreadable or non-regular artifact is refused and repaired', async () => {
          await ensureSessionCli(sandbox, cli, AbortSignal.timeout(TIMEOUT_MS), TIMEOUT_MS)
          await run(`chmod 000 ${cli.path}`, false)
          await expectRefused('ran-after-chmod')
          await ensureSessionCli(sandbox, cli, AbortSignal.timeout(TIMEOUT_MS), TIMEOUT_MS)
          await run(`rm -f ${cli.runtime?.path} && mkfifo ${cli.runtime?.path}`, false)
          const startedAt = performance.now()
          await expectRefused('ran-after-fifo')
          const refusedInMs = Math.round(performance.now() - startedAt)
          await ensureSessionCli(sandbox, cli, AbortSignal.timeout(TIMEOUT_MS), TIMEOUT_MS)
          expect((await run('echo ok')).stdout.trim()).toBe('ok')
          return { fifoRefusedInMs: refusedInMs }
        })

        await check('a Stop during a slow check settles and starts nothing', async () => {
          await run(`rm -f ${cli.runtime?.path} && truncate -s 6G ${cli.runtime?.path}`, false)
          const controller = new AbortController()
          const startedAt = performance.now()
          setTimeout(() => controller.abort(new Error('User Stop')), 1_000)
          // An aborted session command returns its killed process's result; the caller's own
          // abort check turns it into the cancellation.
          const stopped = await sandbox
            .runCommand('touch /tmp/ran-after-stop', {
              timeoutMs: TIMEOUT_MS,
              atMostOnce: true,
              rootUser: false,
              verifyCli,
              signal: controller.signal,
            })
            .then(
              (result) => `exit ${result.exitCode}`,
              (error: unknown) => getErrorMessage(error)
            )
          const settledInMs = Math.round(performance.now() - startedAt)
          expect(settledInMs).toBeLessThan(10_000)
          expect(await ranMarker('ran-after-stop')).toBe('no')
          await ensureSessionCli(sandbox, cli, AbortSignal.timeout(TIMEOUT_MS), TIMEOUT_MS)
          return { settledInMs, stopped }
        })

        await check('a repaired CLI launches again', async () => {
          await run(`echo 'tampered' >> ${cli.path}`, false)
          await expectRefused('ran-before-repair')
          await ensureSessionCli(sandbox, cli, AbortSignal.timeout(TIMEOUT_MS), TIMEOUT_MS)
          const result = await run('touch /tmp/ran-after-repair && echo done')
          expect(result.stdout.trim()).toBe('done')
          expect(await ranMarker('ran-after-repair')).toBe('yes')
        })

        await check('a verified launch keeps its exit code and streams', async () => {
          const result = await run('echo out; echo err >&2; exit 3')
          expect(result).toMatchObject({ exitCode: 3 })
          expect(result.stdout).toContain('out')
          expect(result.stderr).toContain('err')
        })
      } finally {
        await sandbox.kill()
      }
    },
    10 * 60_000
  )
})
