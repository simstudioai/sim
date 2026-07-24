import { spawnSync } from 'node:child_process'
import { DB_CONTAINER, type Detection, REDIS_CONTAINER, runDetection } from './detect.ts'
import { archiveEnvFile, ROOT } from './env-files.ts'
import { SetupError } from './errors.ts'
import { httpHealth } from './probes.ts'
import * as p from './prompter.ts'
import { glyph, theme } from './theme.ts'

const APP_URL = 'http://localhost:3000'
const REALTIME_HEALTH = 'http://localhost:3002/health'
const POSTGRES_VOLUME = 'sim-postgres-data'
const COMPOSE_FILES = ['docker-compose.prod.yml', 'docker-compose.local.yml'] as const
const K8S_RELEASE = 'sim-dev'
const K8S_NAMESPACE = 'sim-dev'

export const LIFECYCLE_COMMANDS = [
  'start',
  'stop',
  'restart',
  'status',
  'logs',
  'down',
  'reset',
] as const
export type LifecycleCommand = (typeof LIFECYCLE_COMMANDS)[number]

export function isLifecycleCommand(value: string): value is LifecycleCommand {
  return (LIFECYCLE_COMMANDS as readonly string[]).includes(value)
}

/**
 * POSIX-quote a value for a copyable shell hint — a kube-context can contain
 * whitespace or metacharacters that would break a copied command.
 */
function shq(value: string): string {
  if (/^[A-Za-z0-9._/-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Non-throwing docker probe; returns trimmed stdout or null on any failure. */
function dockerText(args: string[]): string | null {
  const result = spawnSync('docker', args, { cwd: ROOT, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

/** Docker command whose output the user should see (up, logs); returns exit code. */
function dockerInherit(args: string[]): number {
  return spawnSync('docker', args, { cwd: ROOT, stdio: 'inherit' }).status ?? 1
}

/** Docker command that must succeed; throws a SetupError with stderr on failure. */
function dockerRun(args: string[], failMessage: string): void {
  const result = spawnSync('docker', args, { cwd: ROOT, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new SetupError(`${failMessage}: ${result.stderr.trim() || result.stdout.trim()}`)
  }
}

interface ComposeInstall {
  kind: 'compose'
  file: string
}
interface DevInstall {
  kind: 'dev'
  postgres: boolean
  redis: boolean
}
interface K8sInstall {
  kind: 'k8s'
  context: string
}
type Install = ComposeInstall | DevInstall | K8sInstall

/**
 * A compose project brought up from ROOT reuses the same project name at `ps`,
 * so probing each candidate compose file recovers exactly which one owns
 * containers — no need to guess the project name or persist the choice.
 */
function composeInstalls(): ComposeInstall[] {
  return COMPOSE_FILES.filter((file) => dockerText(['compose', '-f', file, 'ps', '-aq'])).map(
    (file) => ({ kind: 'compose', file })
  )
}

/** Dev mode owns the split env files and, usually, the managed Postgres/Redis. */
function devInstall(detection: Detection): DevInstall | null {
  const postgres = detection.dbContainer?.managed ?? false
  const redis = detection.redisContainer?.managed ?? false
  const splitEnv = detection.envFiles.sim || detection.envFiles.realtime || detection.envFiles.db
  if (!postgres && !redis && !splitEnv) return null
  return { kind: 'dev', postgres, redis }
}

function k8sInstall(detection: Detection): K8sInstall | null {
  const context = detection.kubeContext
  if (!context) return null
  const status = spawnSync(
    'helm',
    ['status', K8S_RELEASE, '--kube-context', context, '-n', K8S_NAMESPACE],
    { stdio: 'ignore' }
  )
  return status.status === 0 ? { kind: 'k8s', context } : null
}

function detectInstalls(detection: Detection): Install[] {
  const installs: Install[] = [...composeInstalls()]
  const dev = devInstall(detection)
  if (dev) installs.push(dev)
  const k8s = k8sInstall(detection)
  if (k8s) installs.push(k8s)
  return installs
}

function describeInstall(install: Install): string {
  if (install.kind === 'compose') return `Docker Compose (${install.file})`
  if (install.kind === 'dev') return 'Local dev (managed Postgres/Redis)'
  return `Kubernetes (context ${install.context})`
}

/** One install → use it; several → let the user pick; none → null. */
async function resolveInstall(installs: Install[]): Promise<Install | null> {
  if (installs.length <= 1) return installs[0] ?? null
  const choice = await p.select({
    message: 'Multiple installs detected — which one?',
    options: installs.map((install, index) => ({
      value: String(index),
      label: describeInstall(install),
    })),
    initialValue: '0',
  })
  return installs[Number(choice)]
}

function managedNames(install: DevInstall): string[] {
  const names: string[] = []
  if (install.postgres) names.push(DB_CONTAINER)
  if (install.redis) names.push(REDIS_CONTAINER)
  return names
}

function k8sReachHints(context: string): string {
  const c = shq(context)
  return [
    `kubectl --context ${c} -n ${K8S_NAMESPACE} port-forward svc/${K8S_RELEASE}-app 3000:3000`,
    `kubectl --context ${c} -n ${K8S_NAMESPACE} get pods`,
  ].join('\n')
}

function start(install: Install): void {
  if (install.kind === 'compose') {
    const spin = p.spinner()
    spin.start('Starting containers…')
    dockerRun(['compose', '-f', install.file, 'up', '-d'], 'docker compose up failed')
    spin.stop('Containers up')
    p.note(
      [`open ${APP_URL}`, 'follow logs:  sim logs', 'stop:         sim stop'].join('\n'),
      'Running'
    )
    return
  }
  if (install.kind === 'dev') {
    const names = managedNames(install)
    for (const name of names) dockerRun(['start', name], `docker start ${name} failed`)
    if (names.length) p.log.step(`Started ${names.join(', ')}`)
    p.note(
      ['start the dev server:  bun run dev:full', 'stop DB/Redis:         sim stop'].join('\n'),
      'Ready'
    )
    return
  }
  p.note(k8sReachHints(install.context), 'Kubernetes is managed with kubectl')
}

function stop(install: Install): void {
  if (install.kind === 'compose') {
    const spin = p.spinner()
    spin.start('Stopping containers…')
    dockerRun(['compose', '-f', install.file, 'stop'], 'docker compose stop failed')
    spin.stop('Containers stopped (data kept)')
    p.note(['start again:  sim start', 'remove:       sim down'].join('\n'), 'Stopped')
    return
  }
  if (install.kind === 'dev') {
    const names = managedNames(install)
    for (const name of names) dockerRun(['stop', name], `docker stop ${name} failed`)
    if (names.length) p.log.step(`Stopped ${names.join(', ')}`)
    p.note(
      'The dev server runs in the foreground — stop it with Ctrl-C in its terminal.',
      'Dev server'
    )
    return
  }
  const c = shq(install.context)
  p.note(
    [
      `scale down:  kubectl --context ${c} -n ${K8S_NAMESPACE} scale deploy --all --replicas=0`,
      `scale up:    kubectl --context ${c} -n ${K8S_NAMESPACE} scale deploy --all --replicas=1`,
      'tear down:   sim down',
    ].join('\n'),
    'Kubernetes'
  )
}

function restart(install: Install): void {
  if (install.kind === 'compose') {
    const spin = p.spinner()
    spin.start('Restarting containers…')
    dockerRun(['compose', '-f', install.file, 'restart'], 'docker compose restart failed')
    spin.stop('Containers restarted')
    p.note(`open ${APP_URL}`, 'Running')
    return
  }
  if (install.kind === 'dev') {
    const names = managedNames(install)
    for (const name of names) dockerRun(['restart', name], `docker restart ${name} failed`)
    if (names.length) p.log.step(`Restarted ${names.join(', ')}`)
    p.note('Restart the dev server manually (Ctrl-C, then bun run dev:full).', 'Dev server')
    return
  }
  p.note(k8sReachHints(install.context), 'Kubernetes is managed with kubectl')
}

function showLogs(install: Install): void {
  if (install.kind === 'compose') {
    dockerInherit(['compose', '-f', install.file, 'logs', '-f', '--tail', '100'])
    return
  }
  if (install.kind === 'dev') {
    const names = managedNames(install)
    p.note(
      [
        'the dev server logs stream in its own terminal (bun run dev:full)',
        ...names.map((name) => `container:  docker logs -f ${name}`),
      ].join('\n'),
      'Logs'
    )
    return
  }
  spawnSync(
    'kubectl',
    ['--context', install.context, '-n', K8S_NAMESPACE, 'logs', '-f', `deploy/${K8S_RELEASE}-app`],
    { stdio: 'inherit' }
  )
}

async function down(install: Install): Promise<void> {
  const ok = await p.confirm({
    message: `Remove ${describeInstall(install)} containers? Data volumes are kept.`,
    initialValue: false,
  })
  if (!ok) {
    p.log.info('Left it running.')
    return
  }
  if (install.kind === 'compose') {
    dockerRun(['compose', '-f', install.file, 'down'], 'docker compose down failed')
    p.log.step('Containers removed (volumes kept)')
    return
  }
  if (install.kind === 'dev') {
    const names = managedNames(install)
    if (names.length) {
      dockerRun(['rm', '-f', ...names], 'docker rm failed')
      p.log.step(`Removed ${names.join(', ')} (Postgres volume ${POSTGRES_VOLUME} kept)`)
    } else {
      p.log.info('No managed containers to remove.')
    }
    return
  }
  const result = spawnSync(
    'helm',
    ['uninstall', K8S_RELEASE, '--kube-context', install.context, '-n', K8S_NAMESPACE],
    { stdio: 'inherit' }
  )
  if (result.status !== 0) throw new SetupError('helm uninstall failed')
  p.log.step(`Uninstalled ${K8S_RELEASE}`)
}

async function reset(install: Install | null): Promise<void> {
  const ok = await p.confirm({
    message: theme.error(
      'Reset archives your .env files and wipes managed data (volumes). Continue?'
    ),
    initialValue: false,
  })
  if (!ok) {
    p.log.info('Reset cancelled.')
    return
  }
  for (const target of ['sim', 'realtime', 'db', 'root'] as const) {
    const backup = archiveEnvFile(target)
    if (backup) p.log.step(`Archived ${backup}`)
  }
  if (install?.kind === 'compose') {
    dockerRun(['compose', '-f', install.file, 'down', '-v'], 'docker compose down -v failed')
    p.log.step('Containers and volumes removed')
  } else if (install?.kind === 'dev') {
    const names = managedNames(install)
    if (names.length) spawnSync('docker', ['rm', '-f', ...names], { cwd: ROOT, stdio: 'ignore' })
    spawnSync('docker', ['volume', 'rm', POSTGRES_VOLUME], { cwd: ROOT, stdio: 'ignore' })
    p.log.step('Managed containers and Postgres volume removed')
  } else if (install?.kind === 'k8s') {
    spawnSync(
      'helm',
      ['uninstall', K8S_RELEASE, '--kube-context', install.context, '-n', K8S_NAMESPACE],
      { stdio: 'inherit' }
    )
  }
  p.note(`start fresh with ${theme.command('sim setup')}`, 'Reset complete')
}

async function status(): Promise<void> {
  const detection = await runDetection()
  const installs = detectInstalls(detection)
  console.log(`\n${theme.heading('◆ Sim status')}\n`)
  if (installs.length === 0) {
    console.log(` ${glyph.warn} No Sim install detected — run ${theme.command('sim setup')}.`)
    return
  }
  for (const install of installs) console.log(` ${glyph.pass} ${describeInstall(install)}`)
  const containerState = (state: { state: 'running' | 'stopped' } | null) =>
    state ? state.state : 'absent'
  console.log()
  console.log(` postgres (${DB_CONTAINER}):  ${containerState(detection.dbContainer)}`)
  console.log(` redis (${REDIS_CONTAINER}):     ${containerState(detection.redisContainer)}`)
  const [app, realtime] = await Promise.all([
    httpHealth(`${APP_URL}/api/health`),
    httpHealth(REALTIME_HEALTH),
  ])
  console.log()
  console.log(` app (:3000)       ${app ? glyph.pass : glyph.fail}`)
  console.log(` realtime (:3002)  ${realtime ? glyph.pass : glyph.fail}`)
}

export async function runLifecycle(command: LifecycleCommand): Promise<void> {
  if (command === 'status') return status()

  const installs = detectInstalls(await runDetection())

  // Reset stays useful with nothing running — it still archives stray .env files.
  if (command === 'reset') return reset(await resolveInstall(installs))

  const install = await resolveInstall(installs)
  if (!install) {
    p.log.warn(`No Sim install detected. Run ${theme.command('sim setup')} first.`)
    return
  }
  switch (command) {
    case 'start':
      return start(install)
    case 'stop':
      return stop(install)
    case 'restart':
      return restart(install)
    case 'logs':
      return showLogs(install)
    case 'down':
      return down(install)
  }
}
