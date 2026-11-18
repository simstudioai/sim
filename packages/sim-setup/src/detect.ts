import { spawnSync } from 'node:child_process'
import net from 'node:net'
import os from 'node:os'
import { ROOT, readEnvFile } from './env-files'
import { executableExists } from './executables'

export const MANAGED_LABEL = 'managed-by=sim-setup'
export const DB_CONTAINER = 'sim-postgres'
export const REDIS_CONTAINER = 'sim-redis'

/**
 * The only host address the managed containers publish on. Docker's default
 * (`-p port:port`) listens on every interface and its rules bypass the host
 * firewall, which would expose a password-less Redis to the network. Clients
 * use this literal rather than `localhost`, which can resolve to `::1`.
 */
export const LOOPBACK_HOST = '127.0.0.1'

/**
 * Whether a container publishes `containerPort` beyond `LOOPBACK_HOST`, read from
 * its static config so a stopped container answers too. Containers created
 * before managed ports were bound to loopback report an empty `HostIp`.
 */
function publishedBeyondLoopback(container: string, containerPort: string): boolean {
  const out = commandOutput('docker', [
    'inspect',
    container,
    '--format',
    `{{json (index .HostConfig.PortBindings "${containerPort}")}}`,
  ])
  if (!out) return false
  try {
    const bindings = JSON.parse(out) as { HostIp?: string }[] | null
    return (bindings ?? []).some((binding) => binding.HostIp !== LOOPBACK_HOST)
  } catch {
    return false
  }
}

/**
 * Managed containers that an earlier sim-setup published on every interface.
 * They are reported, not recreated: Redis holds live realtime sessions and the
 * Postgres URL may name its own database, so replacing either is the user's call.
 */
export function exposedManagedContainers(detection: Detection): string[] {
  const exposed: string[] = []
  if (detection.dbContainer?.managed && publishedBeyondLoopback(DB_CONTAINER, '5432/tcp')) {
    exposed.push(DB_CONTAINER)
  }
  if (detection.redisContainer?.managed && publishedBeyondLoopback(REDIS_CONTAINER, '6379/tcp')) {
    exposed.push(REDIS_CONTAINER)
  }
  return exposed
}

const SHELL_LLM_KEYS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'XAI_API_KEY',
  'MISTRAL_API_KEY',
] as const

export interface Detection {
  dockerRunning: boolean
  appPortOpen: boolean
  realtimePortOpen: boolean
  postgresPortOpen: boolean
  redisPortOpen: boolean
  envFiles: { sim: boolean; realtime: boolean; db: boolean; root: boolean }
  dbContainer: { state: 'running' | 'stopped'; managed: boolean } | null
  redisContainer: { state: 'running' | 'stopped'; managed: boolean } | null
  shellLlmKeys: string[]
  ollamaReachable: boolean
  binaries: { kubectl: boolean; helm: boolean; kind: boolean }
  kubeContext: string | null
  specs: { hostMemGb: number; dockerMemGb: number | null; freeDiskGb: number | null }
}

export function portOpen(port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: LOOPBACK_HOST })
    const done = (result: boolean) => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

export interface PortOwnerInfo {
  command: string
  pid: number
  isDocker: boolean
}

export function portOwner(port: number): PortOwnerInfo | null {
  const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
  if (result.status !== 0) return null
  const line = result.stdout.split('\n')[1]
  if (!line) return null
  const [command, pid] = line.split(/\s+/)
  if (!command || !pid) return null
  return { command, pid: Number(pid), isDocker: /^(com\.docke|docker)/i.test(command) }
}

function commandSucceeds(command: string, args: string[]): boolean {
  return spawnSync(command, args, { stdio: 'ignore' }).status === 0
}

function commandOutput(command: string, args: string[]): string | null {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

function detectContainer(dockerRunning: boolean, name: string): Detection['dbContainer'] {
  if (!dockerRunning) return null
  // Docker's `name=^x$` anchor matches against the internal `/x` form and often
  // misses, so filter loosely (substring) and pin the exact name in code.
  const out = commandOutput('docker', [
    'ps',
    '-a',
    '--filter',
    `name=${name}`,
    '--format',
    '{{.Names}}\t{{.State}}\t{{.Labels}}',
  ])
  if (!out) return null
  const row = out
    .split('\n')
    .map((line) => line.split('\t'))
    .find(([containerName]) => containerName === name)
  if (!row) return null
  const [, state, labels = ''] = row
  return {
    state: state === 'running' ? 'running' : 'stopped',
    managed: labels.includes(MANAGED_LABEL),
  }
}

async function ollamaReachable(): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(800),
    })
    return res.ok
  } catch {
    return false
  }
}

function detectSpecs(dockerRunning: boolean): Detection['specs'] {
  const dockerMem = dockerRunning
    ? commandOutput('docker', ['info', '--format', '{{.MemTotal}}'])
    : null
  const df = spawnSync('df', ['-k', ROOT], { encoding: 'utf8' })
  const dfAvail =
    df.status === 0 ? Number(df.stdout.trim().split('\n')[1]?.split(/\s+/)[3]) : Number.NaN
  return {
    hostMemGb: Math.round(os.totalmem() / 1024 ** 3),
    dockerMemGb: dockerMem ? Math.round((Number(dockerMem) / 1024 ** 3) * 10) / 10 : null,
    freeDiskGb: Number.isNaN(dfAvail) ? null : Math.round(dfAvail / 1024 ** 2),
  }
}

export async function runDetection(): Promise<Detection> {
  const dockerRunning = commandSucceeds('docker', ['info'])
  const [appPortOpen, realtimePortOpen, postgresPortOpen, redisPortOpen, ollamaPortOpen] =
    await Promise.all([
      portOpen(3000),
      portOpen(3002),
      portOpen(5432),
      portOpen(6379),
      portOpen(11434),
    ])
  return {
    dockerRunning,
    appPortOpen,
    realtimePortOpen,
    postgresPortOpen,
    redisPortOpen,
    envFiles: {
      sim: readEnvFile('sim').exists,
      realtime: readEnvFile('realtime').exists,
      db: readEnvFile('db').exists,
      root: readEnvFile('root').exists,
    },
    dbContainer: detectContainer(dockerRunning, DB_CONTAINER),
    redisContainer: detectContainer(dockerRunning, REDIS_CONTAINER),
    shellLlmKeys: SHELL_LLM_KEYS.filter((key) => process.env[key]),
    ollamaReachable: ollamaPortOpen ? await ollamaReachable() : false,
    binaries: {
      kubectl: executableExists('kubectl'),
      helm: executableExists('helm'),
      kind: executableExists('kind'),
    },
    kubeContext: commandOutput('kubectl', ['config', 'current-context']),
    specs: detectSpecs(dockerRunning),
  }
}
