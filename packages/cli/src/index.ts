#!/usr/bin/env node

import { execSync, spawn } from 'child_process'
import { randomBytes } from 'crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import chalk from 'chalk'
import { Command } from 'commander'

const NETWORK_NAME = 'simstudio-network'
const DB_CONTAINER = 'simstudio-db'
const MIGRATIONS_CONTAINER = 'simstudio-migrations'
const REALTIME_CONTAINER = 'simstudio-realtime'
const APP_CONTAINER = 'simstudio-app'
const DEFAULT_PORT = '3000'

const CONFIG_DIR = join(homedir(), '.simstudio')
const SECRETS_PATH = join(CONFIG_DIR, 'secrets.env')
const DATA_DIR = join(CONFIG_DIR, 'data')

const SECRET_KEYS = [
  'BETTER_AUTH_SECRET',
  'ENCRYPTION_KEY',
  'API_ENCRYPTION_KEY',
  'INTERNAL_API_SECRET',
] as const

/**
 * `ENCRYPTION_KEY` and `API_ENCRYPTION_KEY` are read as raw AES-256 material, so the app
 * requires exactly 64 hex characters and throws on anything else. The rest are HMAC secrets
 * of no fixed shape, needing only 32 characters — holding those to the hex form would
 * silently replace a perfectly good secret an operator chose.
 *
 * Placeholders are rejected at any length: the repository publishes example values longer
 * than the 32-character minimum, so a copied `.env.example` would otherwise pass as real.
 *
 * Mirrors `isUsableSecret` in `packages/sim-setup/src/env-files.ts`.
 */
const AES_KEY_PATTERN = /^[0-9a-f]{64}$/i
const AES_SECRET_KEYS = new Set<string>(['ENCRYPTION_KEY', 'API_ENCRYPTION_KEY'])
const MIN_SECRET_LENGTH = 32
const PLACEHOLDER_VALUES = new Set([
  'dev-secret-at-least-32-characters-long',
  'dev-encryption-key-at-least-32-chars',
  'dev-internal-api-secret-min-32-chars',
])

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_VALUES.has(value) || value.startsWith('your_') || value.startsWith('your-')
}

function isUsableSecret(key: string, value: string | undefined): boolean {
  if (!value || isPlaceholder(value)) return false
  return AES_SECRET_KEYS.has(key) ? AES_KEY_PATTERN.test(value) : value.length >= MIN_SECRET_LENGTH
}

/**
 * Per-install secrets, generated on first run and reused afterwards.
 *
 * They have to persist: `ENCRYPTION_KEY` decrypts credentials already stored in the
 * Postgres volume under `~/.simstudio/data`, so minting a fresh one each launch would
 * leave that data permanently unreadable. Only a value that fails its own requirement is
 * replaced.
 *
 * Regenerating one key rewrites the whole file, so the write goes to a temp file and is
 * renamed into place: a plain write truncates first, and a crash mid-write would strand a
 * still-valid `ENCRYPTION_KEY` and orphan the data it protects. Discarding a value that was
 * already there is the one destructive case, so the file is copied aside first and the
 * replacement is reported rather than logged as a routine generation.
 *
 * The file is read the way Docker reads an env file — `KEY=value`, no quote or escape
 * handling — so that what the CLI accepts and what a container would receive cannot diverge.
 *
 * Permissions are reasserted on every run: `writeFileSync`'s `mode` applies only when it
 * creates the file, so a file left by an earlier run — or one the user created — would
 * otherwise keep whatever mode it already had and stay readable by other local accounts.
 */
function resolveSecrets(): Record<string, string> {
  const secrets: Record<string, string> = {}

  if (existsSync(SECRETS_PATH)) {
    for (const line of readFileSync(SECRETS_PATH, 'utf8').split('\n')) {
      if (line.trimStart().startsWith('#')) continue
      const separator = line.indexOf('=')
      if (separator > 0) secrets[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
    }
  }

  const unusable = SECRET_KEYS.filter((key) => !isUsableSecret(key, secrets[key]))
  if (unusable.length === 0) {
    chmodSync(SECRETS_PATH, 0o600)
    return secrets
  }

  const discarded = unusable.filter((key) => secrets[key] !== undefined)
  for (const key of unusable) secrets[key] = randomBytes(32).toString('hex')

  mkdirSync(CONFIG_DIR, { recursive: true })

  if (discarded.length > 0) {
    const backup = `${SECRETS_PATH}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
    copyFileSync(SECRETS_PATH, backup)
    const losesData = discarded.some((key) => AES_SECRET_KEYS.has(key))
    console.log(
      chalk.yellow(
        `⚠️  Replaced unusable ${discarded.join(', ')} in ${SECRETS_PATH}` +
          (losesData ? ', so data encrypted with the previous value can no longer be read' : '') +
          `. The previous file is saved at ${backup}.`
      )
    )
  }

  const contents = SECRET_KEYS.map((key) => `${key}=${secrets[key]}`).join('\n')
  const pending = `${SECRETS_PATH}.tmp`
  writeFileSync(pending, `${contents}\n`, { mode: 0o600 })
  renameSync(pending, SECRETS_PATH)
  chmodSync(SECRETS_PATH, 0o600)

  if (discarded.length < unusable.length) {
    console.log(chalk.gray(`🔑 Generated local secrets in ${SECRETS_PATH}`))
  }

  return secrets
}

const program = new Command()

program.name('simstudio').description('Run Sim using Docker').version('0.1.0')

program
  .option('-p, --port <port>', 'Port to run Sim on', DEFAULT_PORT)
  .option('-y, --yes', 'Skip interactive prompts and use defaults')
  .option('--no-pull', 'Skip pulling the latest Docker images')

function isDockerRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const docker = spawn('docker', ['info'])

    docker.on('close', (code) => {
      resolve(code === 0)
    })
  })
}

async function runCommand(command: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const process = spawn(command[0], command.slice(1), { stdio: 'inherit' })
    process.on('error', () => {
      resolve(false)
    })
    process.on('close', (code) => {
      resolve(code === 0)
    })
  })
}

async function ensureNetworkExists(): Promise<boolean> {
  try {
    const networks = execSync('docker network ls --format "{{.Name}}"').toString()
    if (!networks.includes(NETWORK_NAME)) {
      console.log(chalk.blue(`🔄 Creating Docker network '${NETWORK_NAME}'...`))
      return await runCommand(['docker', 'network', 'create', NETWORK_NAME])
    }
    return true
  } catch (error) {
    console.error('Failed to check networks:', error)
    return false
  }
}

async function pullImage(image: string): Promise<boolean> {
  console.log(chalk.blue(`🔄 Pulling image ${image}...`))
  return await runCommand(['docker', 'pull', image])
}

async function stopAndRemoveContainer(name: string): Promise<void> {
  try {
    execSync(`docker stop ${name} 2>/dev/null || true`)
    execSync(`docker rm ${name} 2>/dev/null || true`)
  } catch (_error) {
    // Ignore errors, container might not exist
  }
}

async function cleanupExistingContainers(): Promise<void> {
  console.log(chalk.blue('🧹 Cleaning up any existing containers...'))
  await stopAndRemoveContainer(APP_CONTAINER)
  await stopAndRemoveContainer(DB_CONTAINER)
  await stopAndRemoveContainer(MIGRATIONS_CONTAINER)
  await stopAndRemoveContainer(REALTIME_CONTAINER)
}

async function main() {
  const options = program.parse().opts()

  console.log(chalk.blue('🚀 Starting Sim...'))

  // An install holding a database but no secrets file predates per-install secrets. Both
  // reads must happen before Docker creates the volume directory on a first run.
  const upgradingExistingInstall =
    existsSync(join(DATA_DIR, 'postgres')) && !existsSync(SECRETS_PATH)

  // Resolved before any container starts so a filesystem problem here does not leave a
  // half-started stack behind.
  let secrets: Record<string, string>
  try {
    secrets = resolveSecrets()
  } catch (error) {
    console.error(chalk.red(`❌ Could not prepare ${SECRETS_PATH}`))
    console.error(chalk.red(`   ${error instanceof Error ? error.message : String(error)}`))
    console.error(chalk.yellow('   Check that you own the file and it is readable and writable.'))
    process.exit(1)
  }

  // Check if Docker is installed and running
  const dockerRunning = await isDockerRunning()
  if (!dockerRunning) {
    console.error(
      chalk.red('❌ Docker is not running or not installed. Please start Docker and try again.')
    )
    process.exit(1)
  }

  // Use port from options, with 3000 as default
  const port = options.port

  // Pull latest images if not skipped
  if (options.pull) {
    await pullImage('ghcr.io/simstudioai/simstudio:latest')
    await pullImage('ghcr.io/simstudioai/migrations:latest')
    await pullImage('ghcr.io/simstudioai/realtime:latest')
    await pullImage('pgvector/pgvector:pg17')
  }

  // Ensure Docker network exists
  if (!(await ensureNetworkExists())) {
    console.error(chalk.red('❌ Failed to create Docker network'))
    process.exit(1)
  }

  // Clean up any existing containers
  await cleanupExistingContainers()

  // Create data directory
  const dataDir = DATA_DIR
  if (!existsSync(dataDir)) {
    try {
      mkdirSync(dataDir, { recursive: true })
    } catch (_error) {
      console.error(chalk.red(`❌ Failed to create data directory: ${dataDir}`))
      process.exit(1)
    }
  }

  // Start PostgreSQL container
  console.log(chalk.blue('🔄 Starting PostgreSQL database...'))
  const dbSuccess = await runCommand([
    'docker',
    'run',
    '-d',
    '--name',
    DB_CONTAINER,
    '--network',
    NETWORK_NAME,
    '-e',
    'POSTGRES_USER=postgres',
    '-e',
    'POSTGRES_PASSWORD=postgres',
    '-e',
    'POSTGRES_DB=simstudio',
    '-v',
    `${dataDir}/postgres:/var/lib/postgresql/data`,
    '-p',
    '5432:5432',
    'pgvector/pgvector:pg17',
  ])

  if (!dbSuccess) {
    console.error(chalk.red('❌ Failed to start PostgreSQL'))
    process.exit(1)
  }

  // Wait for PostgreSQL to be ready
  console.log(chalk.blue('⏳ Waiting for PostgreSQL to be ready...'))
  let pgReady = false
  for (let i = 0; i < 30; i++) {
    try {
      execSync(`docker exec ${DB_CONTAINER} pg_isready -U postgres`)
      pgReady = true
      break
    } catch (_error) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  if (!pgReady) {
    console.error(chalk.red('❌ PostgreSQL failed to become ready'))
    process.exit(1)
  }

  // Run migrations
  console.log(chalk.blue('🔄 Running database migrations...'))
  const migrationsSuccess = await runCommand([
    'docker',
    'run',
    '--rm',
    '--name',
    MIGRATIONS_CONTAINER,
    '--network',
    NETWORK_NAME,
    '-e',
    `DATABASE_URL=postgresql://postgres:postgres@${DB_CONTAINER}:5432/simstudio`,
    'ghcr.io/simstudioai/migrations:latest',
    'bun',
    'run',
    'db:migrate',
  ])

  if (!migrationsSuccess) {
    console.error(chalk.red('❌ Failed to run migrations'))
    process.exit(1)
  }

  // Start the realtime server
  console.log(chalk.blue('🔄 Starting Realtime Server...'))
  const realtimeSuccess = await runCommand([
    'docker',
    'run',
    '-d',
    '--name',
    REALTIME_CONTAINER,
    '--network',
    NETWORK_NAME,
    '-p',
    '3002:3002',
    '-e',
    `DATABASE_URL=postgresql://postgres:postgres@${DB_CONTAINER}:5432/simstudio`,
    '-e',
    `BETTER_AUTH_URL=http://localhost:${port}`,
    '-e',
    `NEXT_PUBLIC_APP_URL=http://localhost:${port}`,
    '-e',
    `BETTER_AUTH_SECRET=${secrets.BETTER_AUTH_SECRET}`,
    '-e',
    `INTERNAL_API_SECRET=${secrets.INTERNAL_API_SECRET}`,
    'ghcr.io/simstudioai/realtime:latest',
  ])

  if (!realtimeSuccess) {
    console.error(chalk.red('❌ Failed to start Realtime Server'))
    process.exit(1)
  }

  // Start the main application
  console.log(chalk.blue('🔄 Starting Sim...'))
  const appSuccess = await runCommand([
    'docker',
    'run',
    '-d',
    '--name',
    APP_CONTAINER,
    '--network',
    NETWORK_NAME,
    '-p',
    `${port}:3000`,
    '-e',
    `DATABASE_URL=postgresql://postgres:postgres@${DB_CONTAINER}:5432/simstudio`,
    '-e',
    `BETTER_AUTH_URL=http://localhost:${port}`,
    '-e',
    `NEXT_PUBLIC_APP_URL=http://localhost:${port}`,
    '-e',
    `BETTER_AUTH_SECRET=${secrets.BETTER_AUTH_SECRET}`,
    '-e',
    `ENCRYPTION_KEY=${secrets.ENCRYPTION_KEY}`,
    '-e',
    // Without this the app stores workspace API keys in plain text. Adding it is safe on an
    // existing install: values that predate it lack the encrypted shape and are read as-is.
    `API_ENCRYPTION_KEY=${secrets.API_ENCRYPTION_KEY}`,
    '-e',
    `INTERNAL_API_SECRET=${secrets.INTERNAL_API_SECRET}`,
    'ghcr.io/simstudioai/simstudio:latest',
  ])

  if (!appSuccess) {
    console.error(chalk.red('❌ Failed to start Sim'))
    process.exit(1)
  }

  console.log(chalk.green(`✅ Sim is now running at ${chalk.bold(`http://localhost:${port}`)}`))

  if (upgradingExistingInstall) {
    console.log(
      chalk.yellow('ℹ️  This install now has its own secrets, so any earlier sign-in has expired.')
    )
  }
  console.log(
    chalk.yellow(
      `🛑 To stop all containers, run: ${chalk.bold('docker stop simstudio-app simstudio-db simstudio-realtime')}`
    )
  )

  // Handle Ctrl+C
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  rl.on('SIGINT', async () => {
    console.log(chalk.yellow('\n🛑 Stopping Sim...'))

    // Stop containers
    await stopAndRemoveContainer(APP_CONTAINER)
    await stopAndRemoveContainer(DB_CONTAINER)
    await stopAndRemoveContainer(REALTIME_CONTAINER)

    console.log(chalk.green('✅ Sim has been stopped'))
    process.exit(0)
  })
}

main().catch((error) => {
  console.error(chalk.red('❌ An error occurred:'), error)
  process.exit(1)
})
