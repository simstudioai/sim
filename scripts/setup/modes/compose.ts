import { spawnSync } from 'node:child_process'
import type { Detection } from '../detect.ts'
import { ensureDocker } from '../docker.ts'
import { ROOT, readEnvFile, writeEnvValues } from '../env-files.ts'
import { SetupError } from '../errors.ts'
import { ensurePortsFree } from '../ports.ts'
import { httpHealth, waitFor } from '../probes.ts'
import * as p from '../prompter.ts'
import {
  collectSecrets,
  mothershipOverride,
  promptCopilotKey,
  promptEmail,
  promptLlmKeys,
  promptSecurity,
  promptSignInProviders,
  promptStorage,
  promptUnlocks,
} from '../steps.ts'
import { glyph, theme } from '../theme.ts'

/**
 * Compose publishes 3000 and 3002 — resolve conflicts before touching docker,
 * instead of letting `docker compose up` die halfway through startup. Aborting
 * is fatal here: compose can't come up while the ports are held.
 */
async function ensureComposePortsFree(composeFile: string): Promise<void> {
  // This stack already holding 3000/3002 is not a conflict — `docker compose up
  // -d` reconciles its own containers. Without this, re-running setup against a
  // running install reports its own realtime container as a blocker and offers
  // to kill Docker's listener, which is never the right move. A genuinely
  // foreign process still gets caught below, and a foreign *container* surfaces
  // as a clear bind error from compose itself.
  const ours = spawnSync('docker', ['compose', '-f', composeFile, 'ps', '-q'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (ours.status === 0 && ours.stdout.trim()) {
    p.log.step('Existing Sim containers hold :3000/:3002 — compose will reconcile them')
    return
  }
  if (await ensurePortsFree([3000, 3002])) return
  throw new SetupError('ports 3000/3002 are in use', [
    `free the ports, then re-run: ${theme.command('bun run setup')}`,
    `see what holds them: ${theme.command('lsof -nP -iTCP:3000 -sTCP:LISTEN')}`,
    `stop a container publishing them: ${theme.command('docker ps')}`,
    `compose file in play: ${composeFile}`,
  ])
}

export async function runComposeMode(detection: Detection, quick: boolean): Promise<void> {
  await ensureDocker(true)
  const variant = quick
    ? 'prod'
    : await p.select({
        message: 'Which images?',
        options: [
          {
            value: 'prod',
            label: 'Published images',
            hint: 'pulls ghcr.io/simstudioai/* — fastest',
          },
          {
            value: 'local',
            label: 'Build from source',
            hint: 'builds docker/*.Dockerfile — for testing local changes',
          },
        ],
        initialValue: 'prod',
      })
  const composeFile = variant === 'prod' ? 'docker-compose.prod.yml' : 'docker-compose.local.yml'

  const root = readEnvFile('root')
  const values = collectSecrets(root)
  const copilotKey = await promptCopilotKey(root.vars.get('COPILOT_API_KEY'))
  if (copilotKey) values.COPILOT_API_KEY = copilotKey
  Object.assign(values, await promptLlmKeys(detection, !quick))
  Object.assign(values, mothershipOverride())
  if (!quick) {
    const storage = await promptStorage(root.vars, true)
    if (storage) Object.assign(values, storage)
    const appUrl = root.vars.get('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3000'
    Object.assign(values, await promptSignInProviders(root.vars, appUrl))
    Object.assign(values, await promptEmail(root.vars))
    const security = await promptSecurity(root.vars)
    Object.assign(values, security.sim, security.mirrorToRealtime)
    Object.assign(values, await promptUnlocks(root.vars))
  }
  if (!root.vars.get('LOG_LEVEL')) {
    values.LOG_LEVEL = 'INFO'
    p.log.step(
      'Set LOG_LEVEL=INFO (production containers default to ERROR, which hides startup problems)'
    )
  }
  if (!root.vars.get('NEXT_TELEMETRY_DISABLED')) values.NEXT_TELEMETRY_DISABLED = '1'
  writeEnvValues('root', values)
  p.log.step('Wrote .env (compose reads it for variable substitution)')

  await ensureComposePortsFree(composeFile)

  p.log.step(`Running docker compose -f ${composeFile} up -d`)
  const result = spawnSync('docker', ['compose', '-f', composeFile, 'up', '-d'], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new SetupError(`docker compose exited with ${result.status}.`, [
      `inspect what failed: ${theme.command(`docker compose -f ${composeFile} logs --tail 50`)}`,
      `container status: ${theme.command(`docker compose -f ${composeFile} ps`)}`,
      `clean slate: ${theme.command(`docker compose -f ${composeFile} down`)} then re-run the wizard`,
    ])
  }

  const spin = p.spinner()
  spin.start('Waiting for Sim to come up (first run pulls images and migrates)…')
  const appHealthy = await waitFor(
    () => httpHealth('http://localhost:3000/api/health'),
    300_000,
    3000
  )
  const realtimeHealthy =
    appHealthy && (await waitFor(() => httpHealth('http://localhost:3002/health'), 60_000, 2000))
  if (!appHealthy || !realtimeHealthy) {
    spin.stop(`${glyph.fail} services did not become healthy`)
    throw new SetupError(
      `${!appHealthy ? 'the app (:3000)' : 'realtime (:3002)'} never answered its health check.`,
      [
        `follow the logs: ${theme.command(`docker compose -f ${composeFile} logs -f`)}`,
        'first boots on slow disks can exceed the wait — if containers are still starting, just wait and open http://localhost:3000',
      ]
    )
  }
  spin.stop('App and realtime are healthy')
}
