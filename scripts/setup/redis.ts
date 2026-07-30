import { spawnSync } from 'node:child_process'
import { docker } from './db.ts'
import { type Detection, REDIS_CONTAINER } from './detect.ts'
import { ensureDocker } from './docker.ts'
import { SetupError } from './errors.ts'
import { redisPing, waitFor } from './probes.ts'
import * as p from './prompter.ts'
import { glyph, theme } from './theme.ts'

const LOCAL_URL = 'redis://localhost:6379'

/**
 * Host port the managed container actually publishes. `startManagedRedis` falls
 * back to 6380 when 6379 is taken, so assuming the default adopts the wrong
 * Redis — or fails the ping and then collides on the container name.
 */
function managedRedisUrl(): string | null {
  const result = spawnSync('docker', ['port', REDIS_CONTAINER, '6379/tcp'], { encoding: 'utf8' })
  if (result.status !== 0) return null
  const port = result.stdout.trim().split('\n')[0]?.split(':').pop()
  return port ? `redis://localhost:${port}` : null
}

async function pingWithSpinner(url: string, label: string): Promise<boolean> {
  const spin = p.spinner()
  spin.start(label)
  const ping = await redisPing(url)
  spin.stop(ping.ok ? 'Redis reachable' : `${glyph.warn} ${ping.error}`)
  return ping.ok
}

async function startManagedRedis(detection: Detection): Promise<string> {
  const hostPort = detection.redisPortOpen ? 6380 : 6379
  const url = `redis://localhost:${hostPort}`
  // A prior sim-redis (unhealthy, or bound to a stale port) would collide on the
  // name. Unlike Postgres this container has no data volume, so removing it
  // loses nothing — no prompt needed. `rm -f` is a no-op when none exists.
  spawnSync('docker', ['rm', '-f', REDIS_CONTAINER], { stdio: 'ignore' })
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
      : `${glyph.fail} container did not become healthy`
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
 * Non-interactive Redis for quick mode: adopt whatever already answers, else
 * start the managed container. Quick's contract is sensible defaults with no
 * questions, and Redis is not optional enough to skip — pub/sub (live Chat
 * status, table events) has no PostgreSQL fallback. Returns null only when
 * nothing answers and Docker is unavailable, so the caller can warn instead of
 * failing the whole setup.
 */
export async function ensureRedis(detection: Detection, existing?: string): Promise<string | null> {
  if (existing && (await redisPing(existing)).ok) return existing
  if (detection.redisPortOpen && (await redisPing(LOCAL_URL)).ok) {
    p.log.step(`Using the Redis already on :6379`)
    return LOCAL_URL
  }
  if (detection.redisContainer?.managed) {
    if (detection.redisContainer.state === 'stopped') docker(['start', REDIS_CONTAINER])
    const managedUrl = managedRedisUrl()
    if (managedUrl && (await waitFor(async () => (await redisPing(managedUrl)).ok, 15_000, 500))) {
      p.log.step(`Reusing ${REDIS_CONTAINER}`)
      return managedUrl
    }
  }
  if (!(await ensureDocker(false))) {
    p.log.warn(
      'Docker is unavailable, so Redis was not configured — live Chat status and table events will not stream.'
    )
    return null
  }
  return startManagedRedis(detection)
}

/**
 * Redis ladder, mirroring the Postgres one: reuse what's running (with
 * consent), restart/start a wizard-managed container, or take a URL.
 */
export async function resolveRedis(detection: Detection, existing?: string): Promise<string> {
  // A configured REDIS_URL wins over the port scan: it may point at a non-default
  // port, or at a host that isn't this machine at all.
  if (
    existing &&
    existing !== LOCAL_URL &&
    (await pingWithSpinner(existing, `Pinging ${existing}…`))
  ) {
    const keep = await p.confirm({ message: `Keep using ${existing}?`, initialValue: true })
    if (keep) return existing
  }

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

  if (detection.redisContainer?.managed) {
    if (detection.redisContainer.state === 'stopped') docker(['start', REDIS_CONTAINER])
    // Read the published port back rather than assuming the default.
    const managedUrl = managedRedisUrl()
    if (
      managedUrl &&
      (await pingWithSpinner(managedUrl, `Starting existing ${REDIS_CONTAINER} container…`))
    ) {
      return managedUrl
    }
    p.log.warn(
      `${REDIS_CONTAINER} exists but is not answering — starting a fresh one will replace it (it holds no data).`
    )
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
