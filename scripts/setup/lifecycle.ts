import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { DB_CONTAINER, type Detection, REDIS_CONTAINER, runDetection } from './detect.ts'
import { archiveEnvFile, ROOT } from './env-files.ts'
import { SetupError } from './errors.ts'
import { isLocalKubeContext } from './modes/k8s.ts'
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

/** Is the Docker daemon reachable? Distinguishes "nothing installed" from "can't see". */
function dockerReachable(): boolean {
  return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0
}

/** Non-throwing docker probe; returns trimmed stdout or null on any failure. */
function dockerText(args: string[], cwd: string = ROOT): string | null {
  const result = spawnSync('docker', args, { cwd, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

/** Docker command whose output the user should see (up, logs); returns exit code. */
function dockerInherit(args: string[], cwd: string = ROOT): number {
  return spawnSync('docker', args, { cwd, stdio: 'inherit' }).status ?? 1
}

/** Docker command that must succeed; throws a SetupError with stderr on failure. */
function dockerRun(args: string[], failMessage: string, cwd: string = ROOT): void {
  const result = spawnSync('docker', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new SetupError(`${failMessage}: ${result.stderr.trim() || result.stdout.trim()}`)
  }
}

interface ComposeInstall {
  kind: 'compose'
  /** Absolute path to the compose file Docker recorded for the project. */
  file: string
  /** Directory the stack was brought up from — every compose op runs here. */
  dir: string
  project: string
}
interface DevInstall {
  kind: 'dev'
  postgres: boolean
  redis: boolean
}
interface K8sInstall {
  kind: 'k8s'
  context: string
  /** False when the context's API server is outside the local allowlist — flagged before destructive ops. */
  local: boolean
}
type Install = ComposeInstall | DevInstall | K8sInstall

interface ComposeProject {
  Name: string
  Status: string
  ConfigFiles: string
}

/**
 * Ask Docker which compose projects exist rather than guessing from the working
 * directory. Compose derives a project name from the directory it was started
 * in, so probing `-f <file> ps` only ever finds a stack when you happen to stand
 * in the checkout that launched it — a globally linked `sim` would never see one
 * — and it reports the same stack once per candidate file, since both files map
 * to the same directory-derived project. `compose ls` records the real project
 * and the exact config file, so one running stack yields exactly one install
 * wherever it was started from. Projects whose compose file isn't one of ours
 * (a devcontainer, an unrelated app) are filtered out by filename.
 */
function composeInstalls(): ComposeInstall[] {
  const raw = dockerText(['compose', 'ls', '-a', '--format', 'json'])
  if (!raw) return []
  let projects: ComposeProject[]
  try {
    projects = JSON.parse(raw)
  } catch {
    return []
  }
  const installs: ComposeInstall[] = []
  for (const project of projects) {
    // ConfigFiles is a comma-separated list when a stack was started with -f more than once.
    const file = (project.ConfigFiles ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .find((entry) => (COMPOSE_FILES as readonly string[]).includes(path.basename(entry)))
    if (!file) continue
    installs.push({
      kind: 'compose',
      file,
      dir: path.dirname(file),
      project: project.Name,
    })
  }
  return installs
}

/** Dev mode owns the split env files and, usually, the managed Postgres/Redis. */
function devInstall(detection: Detection): DevInstall | null {
  const postgres = detection.dbContainer?.managed ?? false
  const redis = detection.redisContainer?.managed ?? false
  const splitEnv = detection.envFiles.sim || detection.envFiles.realtime || detection.envFiles.db
  if (!postgres && !redis && !splitEnv) return null
  return { kind: 'dev', postgres, redis }
}

/**
 * Detection is factual: a release either exists on the current context or it
 * doesn't. Setup lets the user explicitly confirm a context whose API server is
 * outside the local allowlist, so gating detection on locality would strand that
 * release — `status`/`start`/`stop`/`down`/`reset` would all claim there is no
 * Kubernetes install. Instead the locality is recorded and surfaced: every
 * destructive path names the target (and flags a non-local one) before acting.
 */
function k8sInstall(detection: Detection): K8sInstall | null {
  const context = detection.kubeContext
  if (!context) return null
  const status = spawnSync(
    'helm',
    ['status', K8S_RELEASE, '--kube-context', context, '-n', K8S_NAMESPACE],
    { stdio: 'ignore' }
  )
  if (status.status !== 0) return null
  return { kind: 'k8s', context, local: isLocalKubeContext(context) }
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
  if (install.kind === 'compose')
    return `Docker Compose (project ${install.project} in ${install.dir})`
  if (install.kind === 'dev') return 'Local dev (managed Postgres/Redis)'
  // Naming a non-local cluster is the guard against acting on the wrong one after
  // an ambient context switch — every destructive confirm renders this string.
  const scope = install.local ? '' : ' — NOT a verified-local cluster'
  return `Kubernetes (context ${install.context}${scope})`
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
    dockerRun(['compose', '-f', install.file, 'up', '-d'], 'docker compose up failed', install.dir)
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
    dockerRun(['compose', '-f', install.file, 'stop'], 'docker compose stop failed', install.dir)
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
    dockerRun(
      ['compose', '-f', install.file, 'restart'],
      'docker compose restart failed',
      install.dir
    )
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
    dockerInherit(['compose', '-f', install.file, 'logs', '-f', '--tail', '100'], install.dir)
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
    dockerRun(['compose', '-f', install.file, 'down'], 'docker compose down failed', install.dir)
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
  // Name the exact target: k8s acts on the ambient context, so spelling out which
  // cluster (or compose file / dev containers) is about to be wiped keeps a reset
  // from silently hitting the wrong same-named install after a context switch.
  const target = install ? ` ${describeInstall(install)} will be removed.` : ''
  const ok = await p.confirm({
    message: theme.error(
      `Reset archives your .env files and wipes managed data (volumes).${target} Continue?`
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
    dockerRun(
      ['compose', '-f', install.file, 'down', '-v'],
      'docker compose down -v failed',
      install.dir
    )
    p.log.step('Containers and volumes removed')
  } else if (install?.kind === 'dev') {
    const names = managedNames(install)
    if (names.length) spawnSync('docker', ['rm', '-f', ...names], { cwd: ROOT, stdio: 'ignore' })
    spawnSync('docker', ['volume', 'rm', POSTGRES_VOLUME], { cwd: ROOT, stdio: 'ignore' })
    p.log.step('Managed containers and Postgres volume removed')
  } else if (install?.kind === 'k8s') {
    const uninstall = spawnSync(
      'helm',
      ['uninstall', K8S_RELEASE, '--kube-context', install.context, '-n', K8S_NAMESPACE],
      { stdio: 'inherit' }
    )
    // Env files are already archived, so a failed uninstall leaves a live release
    // with no local config — the worst thing to do is call that a success.
    if (uninstall.status !== 0) {
      throw new SetupError(
        `env files were archived, but helm uninstall failed — the ${K8S_RELEASE} release is still running.`,
        [
          `retry: ${theme.command(`helm uninstall ${K8S_RELEASE} --kube-context ${shq(install.context)} -n ${K8S_NAMESPACE}`)}`,
          `check the release: ${theme.command(`helm status ${K8S_RELEASE} --kube-context ${shq(install.context)} -n ${K8S_NAMESPACE}`)}`,
        ]
      )
    }
    p.log.step(`Uninstalled ${K8S_RELEASE}`)
  }
  p.note(`start fresh with ${theme.command('sim setup')}`, 'Reset complete')
}

async function status(): Promise<void> {
  const detection = await runDetection()
  const installs = detectInstalls(detection)
  const docker = dockerReachable()
  console.log(`\n${theme.heading('◆ Sim status')}\n`)
  // Every container probe goes through Docker, so when the daemon is down the
  // honest answer is "unknown", not "absent" — and a compose stack is invisible
  // entirely. Saying "no install detected" there sends the user to re-run setup
  // for what is really a stopped Docker Desktop.
  if (!docker) {
    console.log(
      ` ${glyph.warn} Docker is not reachable — container and Compose state below is unknown.`
    )
    console.log(`   ${theme.muted('start Docker Desktop (or OrbStack), then re-run this.')}\n`)
  }
  if (installs.length === 0) {
    console.log(
      docker
        ? ` ${glyph.warn} No Sim install detected — run ${theme.command('sim setup')}.`
        : ` ${glyph.warn} No install detected, but that may just be Docker being down.`
    )
    return
  }
  for (const install of installs) console.log(` ${glyph.pass} ${describeInstall(install)}`)
  const containerState = (state: { state: 'running' | 'stopped' } | null) =>
    docker ? (state ? state.state : 'absent') : 'unknown (docker down)'
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
