import { spawnSync } from 'node:child_process'
import { getErrorMessage } from '@sim/utils/errors'
import type { Detection } from '../detect.ts'
import { ensureDocker } from '../docker.ts'
import { generateSecret, ROOT } from '../env-files.ts'
import { SetupError } from '../errors.ts'
import { waitFor } from '../probes.ts'
import * as p from '../prompter.ts'
import { glyph, theme } from '../theme.ts'

const RELEASE = 'sim-dev'
const NAMESPACE = 'sim-dev'
const LOCAL_CONTEXT_PREFIXES = ['kind-', 'docker-desktop', 'minikube', 'orbstack']

/**
 * `input` is piped on stdin rather than passed as arguments — argv is readable
 * by any process on the machine, so secrets must never travel that way.
 */
function run(command: string, args: string[], failMessage: string, input?: string): string {
  // `helm upgrade --install ./helm/sim` uses chart paths relative to the repo
  // root, so pin cwd regardless of where the wizard was invoked from.
  const result = spawnSync(command, args, { encoding: 'utf8', input, cwd: ROOT })
  if (result.status !== 0) {
    throw new Error(`${failMessage}: ${result.stderr.trim() || result.stdout.trim()}`)
  }
  return result.stdout
}

function isLocalContext(context: string): boolean {
  return LOCAL_CONTEXT_PREFIXES.some((prefix) => context === prefix || context.startsWith(prefix))
}

const LOCAL_SERVER_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  '0.0.0.0',
  '::1',
  'kubernetes.docker.internal',
  'host.docker.internal',
])

/** True when a context's API server is a loopback/host address — i.e. a local cluster. */
export function isLocalKubeContext(context: string): boolean {
  const server = contextServerHost(context)
  return server !== null && LOCAL_SERVER_HOSTS.has(server)
}

/**
 * Liveness probe — a kubeconfig entry can outlive a stopped or deleted cluster
 * (kind clusters are Docker containers that don't restart on their own), so a
 * context looking local is no guarantee its API server answers.
 */
function clusterReachable(context: string): boolean {
  return (
    spawnSync('kubectl', ['cluster-info', '--context', context, '--request-timeout=5s'], {
      stdio: 'ignore',
    }).status === 0
  )
}

/** The API server host a context points at, or null if kubectl can't resolve it. */
function contextServerHost(context: string): string | null {
  const result = spawnSync(
    'kubectl',
    [
      'config',
      'view',
      '--minify',
      '--context',
      context,
      '-o',
      'jsonpath={.clusters[0].cluster.server}',
    ],
    { encoding: 'utf8' }
  )
  if (result.status !== 0) return null
  try {
    return new URL(result.stdout.trim()).hostname
  } catch {
    return null
  }
}

/**
 * POSIX-quote a value for a copyable shell hint. A kube-context passes only a
 * prefix check, so it can still contain whitespace or shell metacharacters that
 * would break the `--context` argument (or run embedded syntax) when copied.
 * Ordinary context names stay bare; only unsafe ones get single-quoted.
 */
function shq(value: string): string {
  if (/^[A-Za-z0-9._/-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function ensureLocalContext(detection: Detection): Promise<string> {
  if (!detection.binaries.helm || !detection.binaries.kubectl) {
    throw new SetupError('kubernetes mode needs kubectl and helm on PATH.', [
      `install them: ${theme.command('brew install kubectl helm')}`,
    ])
  }
  const context = detection.kubeContext
  if (context && isLocalContext(context)) {
    // The name is only a hint — a remote cluster can be named like a local one
    // (e.g. "kind-prod"). Verify the API server is a loopback/host address before
    // defaulting to "yes", so generated secrets can't silently ship to a remote
    // cluster on a blind Enter.
    const server = contextServerHost(context)
    if (server && LOCAL_SERVER_HOSTS.has(server)) {
      if (!clusterReachable(context)) {
        // The context is local but its cluster isn't answering — stopped or
        // deleted. Don't offer it (helm would just fail); fall through to the
        // kind path, which starts a stopped "sim" cluster or creates one.
        p.log.warn(
          `Context "${context}" points at a local cluster that isn't responding — it looks stopped or deleted. The wizard will start or recreate a kind cluster instead.`
        )
      } else {
        const useIt = await p.confirm({
          message: `Use current kube context "${context}"?`,
          initialValue: true,
        })
        if (useIt) return context
      }
    } else {
      p.log.warn(
        `Context "${context}" is named like a local cluster, but its API server${server ? ` (${server})` : ''} does not look local. Continuing would deploy the generated secrets there.`
      )
      const useIt = await p.confirm({
        message: `Deploy to "${context}" anyway?`,
        initialValue: false,
      })
      if (useIt) return context
    }
  } else if (context) {
    p.log.warn(
      `Current context "${context}" does not look like a local cluster. Deploying to remote clusters is not supported by the wizard yet — switch to a kind/docker-desktop context, or drive helm directly (see helm/sim/examples/values-production.yaml).`
    )
  }
  if (!detection.binaries.kind) {
    throw new SetupError('no local cluster available.', [
      `install kind: ${theme.command('brew install kind')} — the wizard creates the cluster for you`,
      'or enable Kubernetes in Docker Desktop settings, then re-run',
    ])
  }
  await ensureDocker(true)
  const clusters = run('kind', ['get', 'clusters'], 'kind get clusters failed')
    .trim()
    .split('\n')
    .filter(Boolean)
  if (clusters.includes('sim')) {
    run('kind', ['export', 'kubeconfig', '--name', 'sim'], 'kind export kubeconfig failed')
    if (clusterReachable('kind-sim')) {
      p.log.step('Reusing existing kind cluster "sim"')
    } else {
      // The cluster exists in kind but isn't answering — its node containers are
      // stopped (a Docker/machine restart). Start them and wait for the API.
      const spin = p.spinner()
      spin.start('kind cluster "sim" is stopped — starting it…')
      const nodes = run('kind', ['get', 'nodes', '--name', 'sim'], 'kind get nodes failed')
        .trim()
        .split('\n')
        .filter(Boolean)
      for (const node of nodes) spawnSync('docker', ['start', node], { stdio: 'ignore' })
      const up = await waitFor(() => Promise.resolve(clusterReachable('kind-sim')), 60_000, 2000)
      if (!up) {
        spin.stop(`${glyph.fail} kind cluster "sim" would not start`)
        throw new SetupError('the kind cluster "sim" exists but will not come up.', [
          `inspect it: ${theme.command('docker ps -a --filter name=sim-control-plane')}`,
          `recreate it: ${theme.command('kind delete cluster --name sim')}, then re-run ${theme.command('bun run setup')}`,
        ])
      }
      spin.stop('kind cluster "sim" started')
    }
  } else {
    const spin = p.spinner()
    spin.start('Creating kind cluster "sim"…')
    run('kind', ['create', 'cluster', '--name', 'sim'], 'kind create cluster failed')
    spin.stop('kind cluster "sim" ready')
  }
  return 'kind-sim'
}

function existingReleaseSecrets(context: string): Record<string, string> | null {
  const scope = ['--kube-context', context, '-n', NAMESPACE]
  const status = spawnSync('helm', ['status', RELEASE, ...scope], { stdio: 'ignore' })
  if (status.status !== 0) return null
  const values = JSON.parse(
    run('helm', ['get', 'values', RELEASE, ...scope, '-o', 'json'], 'helm get values failed')
  ) as { app?: { env?: Record<string, string> }; postgresql?: { auth?: { password?: string } } }
  const env = values.app?.env ?? {}
  const password = values.postgresql?.auth?.password
  if (
    !env.BETTER_AUTH_SECRET ||
    !env.ENCRYPTION_KEY ||
    !env.INTERNAL_API_SECRET ||
    !env.CRON_SECRET ||
    !password
  ) {
    return null
  }
  return {
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
    ENCRYPTION_KEY: env.ENCRYPTION_KEY,
    INTERNAL_API_SECRET: env.INTERNAL_API_SECRET,
    CRON_SECRET: env.CRON_SECRET,
    POSTGRES_PASSWORD: password,
  }
}

/**
 * Values document piped to helm on stdin instead of `--set`. `JSON.stringify`
 * quotes and escapes each value — JSON is a subset of YAML, so a secret
 * containing `#`, `:`, or a leading `*` can neither break the document nor be
 * reinterpreted as YAML syntax.
 */
function secretValues(secrets: Record<string, string>): string {
  const { POSTGRES_PASSWORD, ...appEnv } = secrets
  const env = Object.entries(appEnv)
    .map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`)
    .join('\n')
  return `app:\n  env:\n${env}\npostgresql:\n  auth:\n    password: ${JSON.stringify(POSTGRES_PASSWORD)}\n`
}

export async function runK8sMode(detection: Detection): Promise<void> {
  // Pin every subsequent call to the context we validated: the ambient context
  // can change between detection and deploy, which would send generated
  // credentials to an unintended cluster.
  const context = await ensureLocalContext(detection)

  const reused = existingReleaseSecrets(context)
  const secrets = reused ?? {
    BETTER_AUTH_SECRET: generateSecret(),
    ENCRYPTION_KEY: generateSecret(),
    INTERNAL_API_SECRET: generateSecret(),
    CRON_SECRET: generateSecret(),
    POSTGRES_PASSWORD: generateSecret().slice(0, 24),
  }
  if (reused) p.log.step('Reusing secrets from the existing release')

  const spin = p.spinner()
  spin.start('helm upgrade --install (first run pulls images — this can take several minutes)…')
  try {
    run(
      'helm',
      [
        'upgrade',
        '--install',
        RELEASE,
        './helm/sim',
        '--kube-context',
        context,
        '--namespace',
        NAMESPACE,
        '--create-namespace',
        '--values',
        './helm/sim/examples/values-development.yaml',
        '--values',
        '-',
        '--wait',
        '--timeout',
        '15m',
      ],
      'helm upgrade --install failed',
      secretValues(secrets)
    )
  } catch (error) {
    spin.stop(`${glyph.fail} helm install failed`)
    throw new SetupError(getErrorMessage(error), [
      `pod status: ${theme.command(`kubectl --context ${shq(context)} -n ${NAMESPACE} get pods`)}`,
      `stuck pods: ${theme.command(`kubectl --context ${shq(context)} -n ${NAMESPACE} describe pod <name> | tail -20`)}`,
      'ImagePullBackOff on ghcr.io/simstudioai/* usually means the chart appVersion tag was never published — check Chart.yaml against ghcr',
    ])
  }
  spin.stop('Release deployed, all pods ready')

  const testSpin = p.spinner()
  testSpin.start('Running helm test…')
  const test = spawnSync('helm', ['test', RELEASE, '--kube-context', context, '-n', NAMESPACE], {
    encoding: 'utf8',
    cwd: ROOT,
  })
  if (test.status !== 0) {
    testSpin.stop(`${glyph.fail} helm test failed`)
    throw new SetupError(`helm test failed:\n${test.stdout}${test.stderr}`, [
      `pod status: ${theme.command(`kubectl --context ${shq(context)} -n ${NAMESPACE} get pods`)}`,
      `app logs: ${theme.command(`kubectl --context ${shq(context)} -n ${NAMESPACE} logs deploy/${RELEASE}-app --tail 50`)}`,
    ])
  }
  testSpin.stop('helm test passed')

  p.note(
    [
      `kubectl --context ${shq(context)} -n ${NAMESPACE} port-forward svc/${RELEASE}-app 3000:3000`,
      `kubectl --context ${shq(context)} -n ${NAMESPACE} get pods`,
      `helm uninstall ${RELEASE} --kube-context ${shq(context)} -n ${NAMESPACE}   # tear down`,
    ].join('\n'),
    'Reach your cluster'
  )
}
