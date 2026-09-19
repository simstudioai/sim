import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { generateSecret } from './env-files'
import { SetupError } from './errors'
import * as p from './prompter'

/**
 * The password Postgres was initialized with on a Compose install created while
 * `docker-compose.prod.yml` still defaulted it. Postgres applies
 * `POSTGRES_PASSWORD` only when it creates the data volume, so such a volume
 * keeps this password until it is rotated inside the database.
 */
export const LEGACY_POSTGRES_PASSWORD = 'postgres'

/** The volume key the Sim Compose files declare for Postgres data. */
const POSTGRES_VOLUME = 'postgres_data'

/**
 * Whether a Compose file refuses to start without `POSTGRES_PASSWORD`. Only the
 * production file does, and the version that requires it is also the one that
 * stops publishing the database, so older files and dev stacks are left alone.
 */
export function composeFileRequiresPostgresPassword(composeFile: string): boolean {
  return readFileSync(composeFile, 'utf8').includes('${POSTGRES_PASSWORD:?')
}

/** Where a chosen `POSTGRES_PASSWORD` came from. */
export type PostgresPasswordSource = 'environment' | 'generated' | 'legacy'

export interface PostgresPasswordChoice {
  value: string
  source: PostgresPasswordSource
}

/**
 * Characters that `.env` would reinterpret — whitespace, comments, quotes,
 * escapes, and Compose's `$` interpolation — so a value containing one cannot
 * be written unquoted and read back unchanged.
 */
const DOTENV_UNSAFE = /[\s#'"\\$]/

interface ChooseOptions {
  /** The shell environment, whose `POSTGRES_PASSWORD` Compose interpolates over `.env`. */
  shell?: NodeJS.ProcessEnv
  hasDatabaseVolume?: (project: string) => boolean
}

/**
 * Picks the `POSTGRES_PASSWORD` to write to a Compose install's `.env`, or null
 * when `.env` already has the right one. The production Compose file requires
 * the variable, and the value must match what the data volume was created with —
 * Postgres ignores `POSTGRES_PASSWORD` on an existing data directory, so a
 * wrong value locks the app out of its own database:
 *
 * - A value exported in the shell is what Compose is using. It is persisted when
 *   `.env` has none, so a later run without the export does not fall back to a
 *   guess. An empty export, one that differs from `.env`, or one `.env` cannot
 *   hold verbatim is refused: which value the volume was created with cannot be
 *   known, and either silent choice can lock the app out.
 * - With no value anywhere, an existing volume was created with the legacy
 *   password, and a project with no volume yet gets a generated one.
 */
export function choosePostgresPassword(
  envFileValue: string | undefined,
  project: string,
  { shell = process.env, hasDatabaseVolume = composeDatabaseVolumeExists }: ChooseOptions = {}
): PostgresPasswordChoice | null {
  const shellValue = shell.POSTGRES_PASSWORD
  if (shellValue === undefined) {
    if (envFileValue) return null
    return hasDatabaseVolume(project)
      ? { value: LEGACY_POSTGRES_PASSWORD, source: 'legacy' }
      : { value: generateSecret(), source: 'generated' }
  }
  if (shellValue === '') {
    throw new SetupError(
      'POSTGRES_PASSWORD is exported but empty, and Compose uses it over .env.',
      ['unset it (unset POSTGRES_PASSWORD) so the value in .env applies']
    )
  }
  if (envFileValue) {
    if (envFileValue === shellValue) return null
    throw new SetupError(
      'POSTGRES_PASSWORD in the shell differs from the one in .env, so it is unclear which one the database was created with.',
      [
        'unset the exported POSTGRES_PASSWORD if .env holds the database password',
        'or set the exported value in .env if that is the database password',
      ]
    )
  }
  if (DOTENV_UNSAFE.test(shellValue)) {
    throw new SetupError(
      'POSTGRES_PASSWORD is exported only in the shell, and contains characters .env cannot store verbatim.',
      [
        'add it to .env yourself, quoted, so later runs without the export still use it',
        'new installs: use a value from openssl rand -hex 24',
      ]
    )
  }
  return { value: shellValue, source: 'environment' }
}

/** Whether a Compose project already has a Postgres data volume, found by Compose's own labels. */
export function composeDatabaseVolumeExists(project: string): boolean {
  const result = spawnSync(
    'docker',
    [
      'volume',
      'ls',
      '-q',
      '--filter',
      `label=com.docker.compose.project=${project}`,
      '--filter',
      `label=com.docker.compose.volume=${POSTGRES_VOLUME}`,
    ],
    { encoding: 'utf8' }
  )
  if (result.status !== 0) {
    throw new SetupError(
      `could not check for an existing database volume: ${result.stderr.trim() || result.stdout.trim()}`
    )
  }
  return result.stdout.trim().length > 0
}

/**
 * The project name Compose resolves for a file run from `cwd` — from `-p`,
 * `COMPOSE_PROJECT_NAME`, or the directory. Read without interpolation, so it
 * works before the required variables exist.
 */
export function composeProjectName(composeFile: string, cwd: string): string {
  const result = spawnSync(
    'docker',
    ['compose', '-f', composeFile, 'config', '--no-interpolate', '--format', 'json'],
    { cwd, encoding: 'utf8' }
  )
  const name = result.status === 0 ? parseProjectName(result.stdout) : null
  if (name) return name
  throw new SetupError(
    `could not resolve the Compose project name for ${composeFile}: ${result.stderr.trim() || 'no name in docker compose config'}`
  )
}

function parseProjectName(stdout: string): string | null {
  try {
    const { name } = JSON.parse(stdout) as { name?: unknown }
    return typeof name === 'string' && name ? name : null
  } catch {
    return null
  }
}

/**
 * Reports what was written. `compose` is the pinned `docker compose -p … -f …`
 * prefix for the install, and `user` the effective `POSTGRES_USER`, both used
 * in the legacy rotation steps.
 */
export function reportPostgresPasswordChoice(
  choice: PostgresPasswordChoice,
  { compose, user, envPath }: { compose: string; user: string; envPath: string }
): void {
  if (choice.source === 'environment') {
    p.log.step(`Saved POSTGRES_PASSWORD from the shell environment to ${envPath}`)
    return
  }
  if (choice.source === 'generated') {
    p.log.step(`Generated POSTGRES_PASSWORD in ${envPath}`)
    return
  }
  p.note(
    [
      `This database was created with the password "${LEGACY_POSTGRES_PASSWORD}", so ${envPath}`,
      `now sets POSTGRES_PASSWORD=${LEGACY_POSTGRES_PASSWORD} to keep it working. The database is not`,
      'published to the host, so only the containers in this stack can reach it. To rotate it:',
      `  ${compose} exec db psql -U ${user} -c "ALTER ROLE CURRENT_USER PASSWORD '<new password>'"`,
      '  then set POSTGRES_PASSWORD=<new password> in .env and run: npx sim-setup start',
    ].join('\n'),
    'Database password'
  )
}

/** The Postgres role Compose initializes, which the shell overrides over `.env` like any variable. */
export function postgresUser(envFileValue: string | undefined): string {
  return process.env.POSTGRES_USER || envFileValue || 'postgres'
}
