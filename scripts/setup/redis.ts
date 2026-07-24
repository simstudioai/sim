import { docker } from './db.ts'
import { type Detection, REDIS_CONTAINER } from './detect.ts'
import { ensureDocker } from './docker.ts'
import { SetupError } from './errors.ts'
import { redisPing, waitFor } from './probes.ts'
import * as p from './prompter.ts'
import { theme } from './theme.ts'

const LOCAL_URL = 'redis://localhost:6379'

async function pingWithSpinner(url: string, label: string): Promise<boolean> {
  const spin = p.spinner()
  spin.start(label)
  const ping = await redisPing(url)
  spin.stop(ping.ok ? 'Redis reachable' : `${theme.warn('!')} ${ping.error}`)
  return ping.ok
}

async function startManagedRedis(detection: Detection): Promise<string> {
  const hostPort = detection.redisPortOpen ? 6380 : 6379
  const url = `redis://localhost:${hostPort}`
  docker([
    'run',
    '-d',
    '--name',
    REDIS_CONTAINER,
    '--label',
    'managed-by=sim-setup',
    '-p',
    `${hostPort}:6379`,
    'redis:7-alpine',
  ])
  const spin = p.spinner()
  spin.start(`Starting ${REDIS_CONTAINER} container on :${hostPort}…`)
  const healthy = await waitFor(async () => (await redisPing(url)).ok, 30_000, 1000)
  spin.stop(
    healthy
      ? `Redis running in ${REDIS_CONTAINER} on :${hostPort}`
      : `${theme.error('✗')} container did not become healthy`
  )
  if (!healthy) {
    throw new SetupError('the Redis container failed to start.', [
      `inspect: ${theme.command(`docker logs ${REDIS_CONTAINER}`)}`,
      `remove and retry: ${theme.command(`docker rm -f ${REDIS_CONTAINER}`)} then re-run the wizard`,
    ])
  }
  return url
}

async function promptRedisUrl(existing?: string): Promise<string> {
  const url = await p.text({
    message: 'REDIS_URL',
    initialValue: existing,
    placeholder: LOCAL_URL,
    validate: (value) => (value ? undefined : 'required'),
  })
  if (!(await pingWithSpinner(url, 'Pinging Redis…'))) {
    throw new SetupError(`Redis at ${url} is not answering.`, [
      'fix the URL and re-run, or skip Redis — single-instance runs fine without it',
    ])
  }
  return url
}

/**
 * Redis ladder, mirroring the Postgres one: reuse what's running (with
 * consent), restart/start a wizard-managed container, or take a URL.
 */
export async function resolveRedis(detection: Detection, existing?: string): Promise<string> {
  if (
    detection.redisPortOpen &&
    (await pingWithSpinner(LOCAL_URL, 'Redis found on :6379 — pinging…'))
  ) {
    const adopt = await p.confirm({
      message: 'Use the Redis already running on localhost:6379?',
      initialValue: true,
    })
    if (adopt) return LOCAL_URL
  }

  if (detection.redisContainer?.managed && detection.redisContainer.state === 'stopped') {
    docker(['start', REDIS_CONTAINER])
    if (await pingWithSpinner(LOCAL_URL, `Starting existing ${REDIS_CONTAINER} container…`)) {
      return LOCAL_URL
    }
  }

  const dockerAvailable = await ensureDocker(false)
  const options: p.SelectOption<'container' | 'url'>[] = []
  if (dockerAvailable) {
    options.push({
      value: 'container',
      label: 'Start a Redis container for me',
      hint: `redis:7-alpine, named ${REDIS_CONTAINER} — recommended`,
    })
  }
  options.push({ value: 'url', label: 'Use an existing Redis', hint: 'paste a redis:// URL' })
  if (!dockerAvailable) {
    p.log.warn('Docker is not available, so the wizard cannot manage a Redis container for you.')
  }
  const choice = await p.select({ message: 'Where should Redis live?', options })
  return choice === 'container' ? startManagedRedis(detection) : promptRedisUrl(existing)
}
