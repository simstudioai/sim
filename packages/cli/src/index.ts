#!/usr/bin/env node

import { execSync, spawn } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
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

const program = new Command()

program.name('simstudio').description('Run Sim Studio using Docker').version('0.1.0')

program
  .option('-p, --port <port>', 'Port to run Sim Studio on', DEFAULT_PORT)
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

  console.log(chalk.blue('🚀 Starting Sim Studio...'))

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
  const dataDir = join(homedir(), '.simstudio', 'data')
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
    'BETTER_AUTH_SECRET=your_auth_secret_here',
    'ghcr.io/simstudioai/realtime:latest',
  ])

  if (!realtimeSuccess) {
    console.error(chalk.red('❌ Failed to start Realtime Server'))
    process.exit(1)
  }

  // Start the main application
  console.log(chalk.blue('🔄 Starting Sim Studio...'))
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
    'BETTER_AUTH_SECRET=your_auth_secret_here',
    '-e',
    'ENCRYPTION_KEY=your_encryption_key_here',
    'ghcr.io/simstudioai/simstudio:latest',
  ])

  if (!appSuccess) {
    console.error(chalk.red('❌ Failed to start Sim Studio'))
    process.exit(1)
  }

  console.log(
    chalk.green(`✅ Sim Studio is now running at ${chalk.bold(`http://localhost:${port}`)}`)
  )
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
    console.log(chalk.yellow('\n🛑 Stopping Sim Studio...'))

    // Stop containers
    await stopAndRemoveContainer(APP_CONTAINER)
    await stopAndRemoveContainer(DB_CONTAINER)
    await stopAndRemoveContainer(REALTIME_CONTAINER)

    console.log(chalk.green('✅ Sim Studio has been stopped'))
    process.exit(0)
  })
}

main().catch((error) => {
  console.error(chalk.red('❌ An error occurred:'), error)
  process.exit(1)
})
