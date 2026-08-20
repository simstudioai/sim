import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { EMAIL_SETUP, STORAGE_SETUP } from '../capability-config'
import { promptCapabilitySetup, stageCapabilitySetupTransition } from '../capability-setup'
import { ensureProductionComposeFile } from '../compose-asset'
import { legacyComposeProjectName, standaloneComposeProjectName } from '../compose-project'
import { SETUP_CONTEXT } from '../context'
import type { Detection } from '../detect'
import { ensureDocker } from '../docker'
import { ROOT, readEnvFile, reconcileEnvValues } from '../env-files'
import { SetupError } from '../errors'
import { ensurePortsFree } from '../ports'
import { httpHealth, waitFor } from '../probes'
import * as p from '../prompter'
import {
  chatFlagValues,
  collectSecrets,
  mothershipOverride,
  promptCopilotKey,
  promptKnowledgeEmbeddings,
  promptLlmKeys,
  promptSecurity,
  promptSignInProviders,
  promptUnlocks,
} from '../steps'
import { glyph, theme } from '../theme'
import { APP_SIGNUP_URL, APP_URL } from '../urls'

const REQUIRED_PORTS = [3000, 3002] as const

interface ComposeProject {
  Name: string
  ConfigFiles: string
}

/** Returns the active Compose project already associated with this exact configuration file. */
function activeComposeProject(composeFile: string): string | null {
  const result = spawnSync('docker', ['compose', 'ls', '-a', '--format', 'json'], {
    encoding: 'utf8',
  })
  if (result.status !== 0) return null

  let projects: ComposeProject[]
  try {
    projects = JSON.parse(result.stdout)
  } catch {
    return null
  }
  const target = path.resolve(composeFile)
  return (
    projects.find((project) =>
      project.ConfigFiles.split(',').some((file) => path.resolve(file.trim()) === target)
    )?.Name ?? null
  )
}

/** Builds a Compose command pinned to the selected standalone project when one is present. */
function composeArgs(
  composeFile: string,
  project: string | undefined,
  ...args: string[]
): string[] {
  return ['compose', ...(project ? ['-p', project] : []), '-f', composeFile, ...args]
}

/** Formats the pinned Compose prefix used in copyable diagnostics. */
function composeCommand(composeFile: string, project: string | undefined): string {
  return `docker compose${project ? ` -p ${project}` : ''} -f ${composeFile}`
}

/**
 * Host ports this compose project currently publishes. Read from the containers
 * rather than assumed from the file, because what matters is what is bound right
 * now — a project with only db/redis up publishes neither app port, so those
 * still need the conflict check.
 */
function composePublishedPorts(composeFile: string, project: string | undefined): Set<number> {
  const ids = spawnSync('docker', composeArgs(composeFile, project, 'ps', '-q'), {
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
async function ensureComposePortsFree(
  composeFile: string,
  project: string | undefined
): Promise<void> {
  // A port this stack already publishes is not a conflict — `docker compose up
  // -d` reconciles its own containers, and reporting the install's own realtime
  // container as a blocker (offering to kill Docker's listener) is never right.
  // Skip only the ports this project actually publishes: leftover db/redis
  // containers must not wave through a foreign process sitting on 3000, which
  // would otherwise surface as a raw compose bind error instead of the prompt.
  const ours = composePublishedPorts(composeFile, project)
  const toCheck = REQUIRED_PORTS.filter((port) => !ours.has(port))
  if (toCheck.length < REQUIRED_PORTS.length) {
    const skipped = REQUIRED_PORTS.filter((port) => ours.has(port))
    p.log.step(`Existing Sim containers hold :${skipped.join(', :')} — compose will reconcile them`)
  }
  if (toCheck.length === 0) return
  if (await ensurePortsFree(toCheck)) return
  throw new SetupError(`ports ${toCheck.map((port) => `:${port}`).join('/')} are in use`, [
    `free the ports, then re-run: ${theme.command('npx sim-setup')}`,
    `see what holds them: ${theme.command('lsof -nP -iTCP:3000 -sTCP:LISTEN')}`,
    `stop a container publishing them: ${theme.command('docker ps')}`,
    `compose file in play: ${composeFile}`,
  ])
}

export async function runComposeMode(detection: Detection, quick: boolean): Promise<void> {
  await ensureDocker(true)
  const variant =
    SETUP_CONTEXT.kind === 'standalone' || quick
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
  const composeFile =
    variant === 'prod' ? ensureProductionComposeFile() : path.join(ROOT, 'docker-compose.local.yml')

  const root = readEnvFile('root')
  const values = collectSecrets(root)
  const remove = new Set<string>()
  const configuredComposeProject = root.vars.get('COMPOSE_PROJECT_NAME')
  const activeProject =
    SETUP_CONTEXT.kind === 'standalone' ? activeComposeProject(composeFile) : null
  if (configuredComposeProject && activeProject && configuredComposeProject !== activeProject) {
    throw new SetupError(
      `COMPOSE_PROJECT_NAME is ${configuredComposeProject}, but ${composeFile} is running as project ${activeProject}.`,
      ['stop the active project or restore its name in .env before running setup again']
    )
  }
  const composeProject =
    SETUP_CONTEXT.kind === 'standalone'
      ? (configuredComposeProject ??
        activeProject ??
        (SETUP_CONTEXT.existing
          ? legacyComposeProjectName(ROOT)
          : standaloneComposeProjectName(ROOT)))
      : undefined
  if (composeProject && !configuredComposeProject) {
    values.COMPOSE_PROJECT_NAME = composeProject
  }
  // Before the key is minted: a half-set override mints against one environment
  // and validates against the other, and warning afterwards is too late — the
  // bad key is already stored, and the next run offers to keep it.
  Object.assign(values, mothershipOverride())
  const copilotKey = await promptCopilotKey(root.vars.get('COPILOT_API_KEY'))
  if (copilotKey) values.COPILOT_API_KEY = copilotKey
  Object.assign(values, chatFlagValues(copilotKey))
  Object.assign(values, await promptLlmKeys(detection, !quick))
  const stagedVars = new Map(root.vars)
  for (const [key, value] of Object.entries(values)) stagedVars.set(key, value)
  const embeddings = await promptKnowledgeEmbeddings(stagedVars, { containerized: true })
  if (embeddings) {
    stageCapabilitySetupTransition(stagedVars, values, remove, embeddings)
  }
  if (!quick) {
    const storage = await promptCapabilitySetup(STORAGE_SETUP, stagedVars, {
      containerized: true,
    })
    stageCapabilitySetupTransition(stagedVars, values, remove, storage)
    const appUrl = root.vars.get('NEXT_PUBLIC_APP_URL') ?? APP_URL
    Object.assign(values, await promptSignInProviders(stagedVars, appUrl))
    const email = await promptCapabilitySetup(EMAIL_SETUP, stagedVars, {
      containerized: true,
    })
    stageCapabilitySetupTransition(stagedVars, values, remove, email)
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
  for (const key of Object.keys(values)) remove.delete(key)
  reconcileEnvValues('root', [...remove], values)
  p.log.step('Wrote .env (compose reads it for variable substitution)')

  const validation = spawnSync('docker', composeArgs(composeFile, composeProject, 'config'), {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (validation.status !== 0) {
    throw new SetupError(
      `docker compose config failed: ${validation.stderr.trim() || validation.stdout.trim()}`
    )
  }

  await ensureComposePortsFree(composeFile, composeProject)

  const command = composeCommand(composeFile, composeProject)
  p.log.step(`Running ${command} up -d`)
  const result = spawnSync('docker', composeArgs(composeFile, composeProject, 'up', '-d'), {
    cwd: ROOT,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new SetupError(`docker compose exited with ${result.status}.`, [
      `inspect what failed: ${theme.command(`${command} logs --tail 50`)}`,
      `container status: ${theme.command(`${command} ps`)}`,
      `clean slate: ${theme.command(`${command} down`)} then re-run the wizard`,
    ])
  }

  const spin = p.spinner()
  spin.start('Waiting for Sim to come up (first run pulls images and migrates)…')
  const appHealthy = await waitFor(() => httpHealth(`${APP_URL}/api/health`), 300_000, 3000)
  const realtimeHealthy =
    appHealthy && (await waitFor(() => httpHealth('http://localhost:3002/health'), 60_000, 2000))
  if (!appHealthy || !realtimeHealthy) {
    spin.stop(`${glyph.fail} services did not become healthy`)
    throw new SetupError(
      `${!appHealthy ? 'the app (:3000)' : 'realtime (:3002)'} never answered its health check.`,
      [
        `follow the logs: ${theme.command(`${command} logs -f`)}`,
        `first boots on slow disks can exceed the wait — if containers are still starting, just wait and open ${APP_SIGNUP_URL}`,
      ]
    )
  }
  spin.stop('App and realtime are healthy')
}
