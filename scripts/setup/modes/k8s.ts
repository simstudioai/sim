import { spawnSync } from 'node:child_process'
import { getErrorMessage } from '@sim/utils/errors'
import type { Detection } from '../detect.ts'
import { ensureDocker } from '../docker.ts'
import { generateSecret, ROOT } from '../env-files.ts'
import { SetupError } from '../errors.ts'
import * as p from '../prompter.ts'
import { theme } from '../theme.ts'

const RELEASE = 'sim-dev'
const NAMESPACE = 'sim-dev'
const LOCAL_CONTEXT_PREFIXES = ['kind-', 'docker-desktop', 'minikube', 'orbstack']

function run(command: string, args: string[], failMessage: string): string {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`${failMessage}: ${result.stderr.trim() || result.stdout.trim()}`)
  }
  return result.stdout
}

function isLocalContext(context: string): boolean {
  return LOCAL_CONTEXT_PREFIXES.some((prefix) => context === prefix || context.startsWith(prefix))
}

async function ensureLocalContext(detection: Detection): Promise<string> {
  if (!detection.binaries.helm || !detection.binaries.kubectl) {
    throw new SetupError('kubernetes mode needs kubectl and helm on PATH.', [
      `install them: ${theme.command('brew install kubectl helm')}`,
    ])
  }
  const context = detection.kubeContext
  if (context && isLocalContext(context)) {
    const useIt = await p.confirm({
      message: `Use current kube context "${context}"?`,
      initialValue: true,
    })
    if (useIt) return context
  }
  if (context && !isLocalContext(context)) {
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
    p.log.step('Reusing existing kind cluster "sim"')
  } else {
    const spin = p.spinner()
    spin.start('Creating kind cluster "sim"…')
    run('kind', ['create', 'cluster', '--name', 'sim'], 'kind create cluster failed')
    spin.stop('kind cluster "sim" ready')
  }
  return 'kind-sim'
}

function existingReleaseSecrets(): Record<string, string> | null {
  const status = spawnSync('helm', ['status', RELEASE, '-n', NAMESPACE], { stdio: 'ignore' })
  if (status.status !== 0) return null
  const values = JSON.parse(
    run('helm', ['get', 'values', RELEASE, '-n', NAMESPACE, '-o', 'json'], 'helm get values failed')
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

export async function runK8sMode(detection: Detection): Promise<void> {
  await ensureLocalContext(detection)

  const reused = existingReleaseSecrets()
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
        '--namespace',
        NAMESPACE,
        '--create-namespace',
        '--values',
        './helm/sim/examples/values-development.yaml',
        '--set',
        `app.env.BETTER_AUTH_SECRET=${secrets.BETTER_AUTH_SECRET}`,
        '--set',
        `app.env.ENCRYPTION_KEY=${secrets.ENCRYPTION_KEY}`,
        '--set',
        `app.env.INTERNAL_API_SECRET=${secrets.INTERNAL_API_SECRET}`,
        '--set',
        `app.env.CRON_SECRET=${secrets.CRON_SECRET}`,
        '--set',
        `postgresql.auth.password=${secrets.POSTGRES_PASSWORD}`,
        '--wait',
        '--timeout',
        '15m',
      ],
      'helm upgrade --install failed'
    )
  } catch (error) {
    spin.stop(`${theme.error('✗')} helm install failed`)
    throw new SetupError(getErrorMessage(error), [
      `pod status: ${theme.command(`kubectl -n ${NAMESPACE} get pods`)}`,
      `stuck pods: ${theme.command(`kubectl -n ${NAMESPACE} describe pod <name> | tail -20`)}`,
      'ImagePullBackOff on ghcr.io/simstudioai/* usually means the chart appVersion tag was never published — check Chart.yaml against ghcr',
    ])
  }
  spin.stop('Release deployed, all pods ready')

  const testSpin = p.spinner()
  testSpin.start('Running helm test…')
  const test = spawnSync('helm', ['test', RELEASE, '-n', NAMESPACE], {
    encoding: 'utf8',
    cwd: ROOT,
  })
  if (test.status !== 0) {
    testSpin.stop(`${theme.error('✗')} helm test failed`)
    throw new SetupError(`helm test failed:\n${test.stdout}${test.stderr}`, [
      `pod status: ${theme.command(`kubectl -n ${NAMESPACE} get pods`)}`,
      `app logs: ${theme.command(`kubectl -n ${NAMESPACE} logs deploy/${RELEASE}-app --tail 50`)}`,
    ])
  }
  testSpin.stop('helm test passed')

  p.note(
    [
      `kubectl -n ${NAMESPACE} port-forward svc/${RELEASE}-app 3000:3000`,
      `kubectl -n ${NAMESPACE} get pods`,
      `helm uninstall ${RELEASE} -n ${NAMESPACE}   # tear down`,
    ].join('\n'),
    'Reach your cluster'
  )
}
