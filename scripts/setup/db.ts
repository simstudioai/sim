import { spawnSync } from 'node:child_process'
import { DB_CONTAINER, type Detection } from './detect.ts'
import { ensureDocker } from './docker.ts'
import { generateSecret } from './env-files.ts'
import { SetupError } from './errors.ts'
import { pgProbe, waitFor } from './probes.ts'
import * as p from './prompter.ts'
import { glyph, theme } from './theme.ts'

const DEFAULT_DSN = 'postgresql://postgres:postgres@localhost:5432/simstudio'

export function docker(args: string[]): void {
  const result = spawnSync('docker', args, { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`docker ${args[0]} failed: ${result.stderr.trim() || result.stdout.trim()}`)
  }
}

function dockerOutput(args: string[]): string | null {
  const result = spawnSync('docker', args, { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

interface ManagedContainer {
  running: boolean
  dsn: string
}

/**
 * Recovers everything needed to reach an existing managed container from Docker
 * itself, so re-running the wizard is idempotent.
 *
 * Both facts used to be unrecoverable: the password is generated at creation and
 * only lived in the env files the run wrote, and the host port varies (5433 when
 * 5432 is taken). Reading them back turns "a container already exists" from a
 * fatal name collision into a reuse.
 */
function inspectManagedContainer(): ManagedContainer | null {
  const running = dockerOutput(['inspect', DB_CONTAINER, '--format', '{{.State.Running}}'])
  if (running === null) return null

  const env = dockerOutput([
    'inspect',
    DB_CONTAINER,
    '--format',
    '{{range .Config.Env}}{{println .}}{{end}}',
  ])
  const password = env
    ?.split('\n')
    .find((line) => line.startsWith('POSTGRES_PASSWORD='))
    ?.slice('POSTGRES_PASSWORD='.length)
  if (!password) return null

  // `docker port` only reports a published port while the container runs; the
  // static config carries it either way.
  const hostPort = dockerOutput([
    'inspect',
    DB_CONTAINER,
    '--format',
    '{{(index .HostConfig.PortBindings "5432/tcp" 0).HostPort}}',
  ])
  if (!hostPort) return null

  return {
    running: running === 'true',
    dsn: `postgresql://postgres:${password}@localhost:${hostPort}/simstudio`,
  }
}

/** Starts the container if needed and returns its DSN, or null if it won't answer. */
async function reuseManagedContainer(container: ManagedContainer): Promise<string | null> {
  if (!container.running) docker(['start', DB_CONTAINER])
  const spin = p.spinner()
  spin.start(`Reusing existing ${DB_CONTAINER} container…`)
  const healthy = await waitFor(async () => (await pgProbe(container.dsn)).ok, 30_000, 1500)
  spin.stop(
    healthy
      ? `Postgres running in ${DB_CONTAINER} on :${new URL(container.dsn).port}`
      : `${glyph.warn} ${DB_CONTAINER} exists but is not answering`
  )
  return healthy ? container.dsn : null
}

async function probeWithSpinner(dsn: string, label: string): Promise<boolean> {
  const spin = p.spinner()
  spin.start(label)
  const probe = await pgProbe(dsn)
  if (probe.ok && probe.pgvectorAvailable === false) {
    spin.stop(`${glyph.warn} connected, but pgvector is missing on that Postgres`)
    return false
  }
  spin.stop(probe.ok ? 'database reachable (pgvector available)' : `${glyph.warn} ${probe.error}`)
  return probe.ok
}

async function promptExternalDsn(): Promise<string> {
  for (;;) {
    const dsn = await p.text({
      message: 'Postgres connection string (needs the pgvector extension)',
      placeholder: DEFAULT_DSN,
      validate: (value) => {
        if (!value) return 'required'
        try {
          new URL(value)
          return undefined
        } catch {
          return 'not a valid connection URL'
        }
      },
    })
    if (await probeWithSpinner(dsn, 'Testing connection…')) return dsn
    const retry = await p.confirm({
      message: 'Connection failed — try a different URL?',
      initialValue: true,
    })
    if (!retry) {
      throw new SetupError('no usable Postgres.', [
        'install Docker — the wizard manages a pgvector container for you',
        'or bring any Postgres with the pgvector extension and re-run with its connection string',
      ])
    }
  }
}

/**
 * Provisions the managed container, reconciling with one that already exists
 * rather than colliding on the name. Recreating is always an explicit choice —
 * the data volume outlives the container, so a silent recreate would quietly
 * re-point setup at data the user may not expect.
 */
async function startManagedContainer(detection: Detection): Promise<string> {
  const existing = inspectManagedContainer()
  if (existing) {
    const reused = await reuseManagedContainer(existing)
    if (reused) return reused

    const recreate = await p.confirm({
      message: `${DB_CONTAINER} exists but is not answering. Remove and recreate it? Its data volume is kept.`,
      initialValue: true,
    })
    if (!recreate) {
      throw new SetupError(`the existing ${DB_CONTAINER} container is not usable.`, [
        `inspect: ${theme.command(`docker logs ${DB_CONTAINER}`)}`,
        `remove it: ${theme.command(`docker rm -f ${DB_CONTAINER}`)}`,
        `start clean: ${theme.command('docker volume rm sim-postgres-data')} drops its data too`,
      ])
    }
    docker(['rm', '-f', DB_CONTAINER])
  }

  const password = generateSecret().slice(0, 24)
  const hostPort = detection.postgresPortOpen ? 5433 : 5432
  const dsn = `postgresql://postgres:${password}@localhost:${hostPort}/simstudio`
  docker([
    'run',
    '-d',
    '--name',
    DB_CONTAINER,
    '--label',
    'managed-by=sim-setup',
    '-v',
    'sim-postgres-data:/var/lib/postgresql/data',
    '-e',
    `POSTGRES_PASSWORD=${password}`,
    '-e',
    'POSTGRES_DB=simstudio',
    '-p',
    `${hostPort}:5432`,
    'pgvector/pgvector:pg17',
  ])
  const spin = p.spinner()
  spin.start(`Starting ${DB_CONTAINER} container on :${hostPort}…`)
  const healthy = await waitFor(async () => (await pgProbe(dsn)).ok, 45_000, 1500)
  if (!healthy) {
    spin.stop(`${glyph.fail} container did not become healthy`)
    const logs = spawnSync('docker', ['logs', '--tail', '20', DB_CONTAINER], { encoding: 'utf8' })
    throw new SetupError(
      `the Postgres container failed to start. Last logs:\n${logs.stdout}${logs.stderr}`,
      [
        `inspect: ${theme.command(`docker logs ${DB_CONTAINER}`)}`,
        `remove and retry: ${theme.command(`docker rm -f ${DB_CONTAINER}`)} then re-run the wizard`,
      ]
    )
  }
  spin.stop(`Postgres running in ${DB_CONTAINER} on :${hostPort}`)
  return dsn
}

/**
 * The mode-B database ladder: reuse a working DSN, offer (never silently adopt)
 * a Postgres already on 5432, start/reuse the wizard-managed pgvector
 * container, or take an external DSN. Adopting an existing database is always
 * an explicit choice — migrations run against whatever is chosen here.
 */
export async function resolveDatabase(detection: Detection, existingDsn?: string): Promise<string> {
  if (existingDsn && (await probeWithSpinner(existingDsn, 'Testing existing DATABASE_URL…'))) {
    return existingDsn
  }

  // Any managed container, running or stopped — a running one used to fall
  // through to `docker run` and die on the name collision.
  if (detection.dbContainer?.managed) {
    const existing = inspectManagedContainer()
    const reused = existing && (await reuseManagedContainer(existing))
    if (reused) return reused
  }

  if (
    detection.postgresPortOpen &&
    (await probeWithSpinner(DEFAULT_DSN, 'Postgres found on :5432 — testing default credentials…'))
  ) {
    const adopt = await p.confirm({
      message: `Use the existing Postgres on :5432? Migrations will run against its "simstudio" database — if that's your dev data, say no and get an isolated container instead.`,
      initialValue: false,
    })
    if (adopt) return DEFAULT_DSN
  }

  const dockerAvailable = await ensureDocker(false)
  const options: p.SelectOption<'container' | 'external'>[] = []
  if (dockerAvailable) {
    options.push({
      value: 'container',
      label: 'Start a Postgres container for me',
      hint: `pgvector/pgvector:pg17, persistent volume, named ${DB_CONTAINER} — recommended`,
    })
  }
  options.push({
    value: 'external',
    label: 'Use an existing Postgres',
    hint: 'paste a connection string (needs pgvector)',
  })
  if (!dockerAvailable) {
    p.log.warn('Docker is not available, so the wizard cannot manage a Postgres container for you.')
  }
  const choice = await p.select({ message: 'Where should the database live?', options })
  return choice === 'container' ? startManagedContainer(detection) : promptExternalDsn()
}
