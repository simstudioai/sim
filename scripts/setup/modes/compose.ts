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

const REQUIRED_PORTS = [3000, 3002] as const

/**
 * Host ports this compose project currently publishes. Read from the containers
 * rather than assumed from the file, because what matters is what is bound right
 * now — a project with only db/redis up publishes neither app port, so those
 * still need the conflict check.
 */
function composePublishedPorts(composeFile: string): Set<number> {
  const ids = spawnSync('docker', ['compose', '-f', composeFile, 'ps', '-q'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  const containers = ids.status === 0 ? ids.stdout.split('\n').filter(Boolean) : []
  if (containers.length === 0) return new Set()

  const inspect = spawnSync(
    'docker',
    [
      'inspect',
      ...containers,
      '--format',
      '{{range $port, $bindings := .HostConfig.PortBindings}}{{range $bindings}}{{.HostPort}} {{end}}{{end}}',
    ],
    { encoding: 'utf8' }
  )
  if (inspect.status !== 0) return new Set()
  const published = new Set<number>()
  for (const token of inspect.stdout.split(/\s+/)) {
    const port = Number(token)
    if (Number.isInteger(port) && port > 0) published.add(port)
  }
  return published
}

/**
 * Compose publishes 3000 and 3002 — resolve conflicts before touching docker,
 * instead of letting `docker compose up` die halfway through startup. Aborting
 * is fatal here: compose can't come up while the ports are held.
 */
async function ensureComposePortsFree(composeFile: string): Promise<void> {
  // A port this stack already publishes is not a conflict — `docker compose up
  // -d` reconciles its own containers, and reporting the install's own realtime
  // container as a blocker (offering to kill Docker's listener) is never right.
  // Skip only the ports this project actually publishes: leftover db/redis
  // containers must not wave through a foreign process sitting on 3000, which
  // would otherwise surface as a raw compose bind error instead of the prompt.
  const ours = composePublishedPorts(composeFile)
  const toCheck = REQUIRED_PORTS.filter((port) => !ours.has(port))
  if (toCheck.length < REQUIRED_PORTS.length) {
    const skipped = REQUIRED_PORTS.filter((port) => ours.has(port))
    p.log.step(`Existing Sim containers hold :${skipped.join(', :')} — compose will reconcile them`)
  }
  if (toCheck.length === 0) return
  if (await ensurePortsFree(toCheck)) return
  throw new SetupError(`ports ${toCheck.map((port) => `:${port}`).join('/')} are in use`, [
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
  // Before the key is minted: a half-set override mints against one environment
  // and validates against the other, and warning afterwards is too late — the
  // bad key is already stored, and the next run offers to keep it.
  Object.assign(values, mothershipOverride())
  const copilotKey = await promptCopilotKey(root.vars.get('COPILOT_API_KEY'))
  if (copilotKey) values.COPILOT_API_KEY = copilotKey
  Object.assign(values, await promptLlmKeys(detection, !quick))
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
