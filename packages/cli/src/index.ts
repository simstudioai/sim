#!/usr/bin/env node

import { execSync, spawn } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { createInterface } from 'readline'
import { randomBytes } from 'crypto'
import chalk from 'chalk'
import { Command } from 'commander'

export interface Config {
  port: number
  pullImages: boolean
  yes: boolean
  dataDir: string
  networkName: string
  dbContainer: string
  migrationsContainer: string
  realtimeContainer: string
  appContainer: string
  dbImage: string
  migrationsImage: string
  realtimeImage: string
  appImage: string
  postgresUser: string
  postgresPassword: string
  postgresDb: string
  realtimePort: number
  betterAuthSecret: string
  encryptionKey: string
}

export const DEFAULT_CONFIG: Partial<Config> = {
  port: 3000,
  pullImages: true,
  yes: false,
  dataDir: join(homedir(), '.simstudio', 'data'),
  networkName: 'simstudio-network',
  dbContainer: 'simstudio-db',
  migrationsContainer: 'simstudio-migrations',
  realtimeContainer: 'simstudio-realtime',
  appContainer: 'simstudio-app',
  dbImage: 'pgvector/pgvector:pg17',
  migrationsImage: 'ghcr.io/simstudioai/migrations:latest',
  realtimeImage: 'ghcr.io/simstudioai/realtime:latest',
  appImage: 'ghcr.io/simstudioai/simstudio:latest',
  postgresUser: 'postgres',
  postgresPassword: 'postgres',
  postgresDb: 'simstudio',
  realtimePort: 3002,
  betterAuthSecret: '',
  encryptionKey: '',
}

const program = new Command()
  .name('simstudio')
  .description('Run Sim using Docker')
  .version('0.1.0')

program
  .option('-p, --port <port>', 'Port to run Sim on', `${DEFAULT_CONFIG.port}`)
  .option('-r, --realtime-port <port>', 'Port for Realtime server', `${DEFAULT_CONFIG.realtimePort}`)
  .option('-d, --data-dir <path>', 'Data directory for persistent storage', DEFAULT_CONFIG.dataDir)
  .option('--no-pull', 'Skip pulling the latest Docker images')
  .option('-y, --yes', 'Skip interactive prompts and use defaults')

/**
 * Generates a random secret string of specified length.
 * @param length - The length of the secret.
 * @returns Base64-encoded random bytes as string.
 */
export function generateSecret(length: number = 32): string {
  return randomBytes(length).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, length)
}

/**
 * Validates if a port is available (simple check via netstat-like command).
 * @param port - The port to check.
 * @returns True if port is available.
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  try {
    execSync(`lsof -i :${port} || netstat -an | grep :${port} || ss -tuln | grep :${port}`, { stdio: 'ignore' })
    return false // Port in use if command succeeds without error
  } catch {
    return true // Port available
  }
}

/**
 * Checks if Docker is running.
 * @returns Promise resolving to true if Docker is running.
 */
export async function isDockerRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const docker = spawn('docker', ['info'], { stdio: 'ignore' })
    docker.on('close', (code) => resolve(code === 0))
    docker.on('error', () => resolve(false))
  })
}

/**
 * Runs a shell command asynchronously, inheriting stdio for output.
 * @param command - Array of command and args.
 * @returns Promise resolving to true if command succeeded.
 */
export async function runCommand(command: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const [cmd, ...args] = command
    const process = spawn(cmd, args, { stdio: 'inherit' })
    process.on('error', () => resolve(false))
    process.on('close', (code) => resolve(code === 0))
  })
}

/**
 * Ensures the Docker network exists.
 * @param networkName - Name of the network.
 * @returns Promise resolving to true if network exists or was created.
 */
export async function ensureNetworkExists(networkName: string): Promise<boolean> {
  try {
    const networksOutput = execSync('docker network ls --format "{{.Name}}"', { encoding: 'utf8' })
    if (!networksOutput.trim().split('\n').includes(networkName)) {
      console.log(chalk.blue(`🔄 Creating Docker network '${networkName}'...`))
      return await runCommand(['docker', 'network', 'create', networkName])
    }
    console.log(chalk.blue(`✅ Docker network '${networkName}' already exists.`))
    return true
  } catch (error) {
    console.error(chalk.red(`❌ Failed to ensure network '${networkName}':`), error)
    return false
  }
}

/**
 * Pulls a Docker image if specified.
 * @param image - The image name and tag.
 * @returns Promise resolving to true if pull succeeded.
 */
export async function pullImage(image: string): Promise<boolean> {
  console.log(chalk.blue(`🔄 Pulling image ${image}...`))
  return await runCommand(['docker', 'pull', image])
}

/**
 * Stops and removes a container if it exists.
 * @param name - Container name.
 */
export async function stopAndRemoveContainer(name: string): Promise<void> {
  try {
    await runCommand(['docker', 'stop', name])
    await runCommand(['docker', 'rm', name])
  } catch (error) {
    // Ignore if container doesn't exist
    console.debug(`Container ${name} not found or already stopped.`)
  }
}

/**
 * Cleans up all existing containers.
 * @param config - Configuration object.
 * @returns Promise resolving when cleanup is complete.
 */
export async function cleanupExistingContainers(config: Config): Promise<void> {
  console.log(chalk.blue('🧹 Cleaning up existing containers...'))
  await Promise.all([
    stopAndRemoveContainer(config.appContainer),
    stopAndRemoveContainer(config.dbContainer),
    stopAndRemoveContainer(config.migrationsContainer),
    stopAndRemoveContainer(config.realtimeContainer),
  ])
}

/**
 * Creates the data directory if it doesn't exist.
 * @param dataDir - Path to data directory.
 * @returns True if directory was created or exists.
 */
export function ensureDataDir(dataDir: string): boolean {
  if (!existsSync(dataDir)) {
    try {
      mkdirSync(dataDir, { recursive: true })
      console.log(chalk.blue(`📁 Created data directory: ${dataDir}`))
      return true
    } catch (error) {
      console.error(chalk.red(`❌ Failed to create data directory '${dataDir}':`), error)
      return false
    }
  }
  console.log(chalk.blue(`✅ Data directory exists: ${dataDir}`))
  return true
}

/**
 * Starts the PostgreSQL container.
 * @param config - Configuration object.
 * @returns Promise resolving to true if DB started successfully.
 */
export async function startDatabase(config: Config): Promise<boolean> {
  console.log(chalk.blue('🔄 Starting PostgreSQL database...'))
  const volume = `${config.dataDir}/postgres:/var/lib/postgresql/data`
  const dbPort = '5432:5432'
  const envVars = [
    '-e', `POSTGRES_USER=${config.postgresUser}`,
    '-e', `POSTGRES_PASSWORD=${config.postgresPassword}`,
    '-e', `POSTGRES_DB=${config.postgresDb}`,
  ]
  const command = [
    'docker', 'run', '-d', '--name', config.dbContainer,
    '--network', config.networkName,
    '-v', volume,
    '-p', dbPort,
    ...envVars,
    config.dbImage,
  ]
  return await runCommand(command)
}

/**
 * Waits for PostgreSQL to be ready with timeout.
 * @param containerName - DB container name.
 * @param timeoutMs - Timeout in milliseconds (default 5 minutes).
 * @returns Promise resolving to true if ready within timeout.
 */
export async function waitForPgReady(containerName: string, timeoutMs: number = 300000): Promise<boolean> {
  console.log(chalk.blue('⏳ Waiting for PostgreSQL to be ready...'))
  const startTime = Date.now()
  while (Date.now() - startTime < timeoutMs) {
    try {
      execSync(`docker exec ${containerName} pg_isready -U ${DEFAULT_CONFIG.postgresUser!}`, { stdio: 'ignore' })
      console.log(chalk.green('✅ PostgreSQL is ready!'))
      return true
    } catch {
      // Wait 2s between checks
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }
  return false
}

/**
 * Runs database migrations.
 * @param config - Configuration object.
 * @returns Promise resolving to true if migrations succeeded.
 */
export async function runMigrations(config: Config): Promise<boolean> {
  console.log(chalk.blue('🔄 Running database migrations...'))
  const dbUrl = `postgresql://${config.postgresUser}:${config.postgresPassword}@${config.dbContainer}:5432/${config.postgresDb}`
  const command = [
    'docker', 'run', '--rm', '--name', config.migrationsContainer,
    '--network', config.networkName,
    '-e', `DATABASE_URL=${dbUrl}`,
    config.migrationsImage, 'bun', 'run', 'db:migrate',
  ]
  return await runCommand(command)
}

/**
 * Starts the Realtime server container.
 * @param config - Configuration object.
 * @returns Promise resolving to true if Realtime started successfully.
 */
export async function startRealtime(config: Config): Promise<boolean> {
  console.log(chalk.blue('🔄 Starting Realtime Server...'))
  const dbUrl = `postgresql://${config.postgresUser}:${config.postgresPassword}@${config.dbContainer}:5432/${config.postgresDb}`
  const appUrl = `http://localhost:${config.port}`
  const realtimePortMapping = `${config.realtimePort}:3002`
  const envVars = [
    '-e', `DATABASE_URL=${dbUrl}`,
    '-e', `BETTER_AUTH_URL=${appUrl}`,
    '-e', `NEXT_PUBLIC_APP_URL=${appUrl}`,
    '-e', `BETTER_AUTH_SECRET=${config.betterAuthSecret}`,
  ]
  const command = [
    'docker', 'run', '-d', '--name', config.realtimeContainer,
    '--network', config.networkName,
    '-p', realtimePortMapping,
    ...envVars,
    config.realtimeImage,
  ]
  return await runCommand(command)
}

/**
 * Starts the main Sim application container.
 * @param config - Configuration object.
 * @returns Promise resolving to true if App started successfully.
 */
export async function startApp(config: Config): Promise<boolean> {
  console.log(chalk.blue('🔄 Starting Sim application...'))
  const dbUrl = `postgresql://${config.postgresUser}:${config.postgresPassword}@${config.dbContainer}:5432/${config.postgresDb}`
  const appUrl = `http://localhost:${config.port}`
  const portMapping = `${config.port}:3000`
  const envVars = [
    '-e', `DATABASE_URL=${dbUrl}`,
    '-e', `BETTER_AUTH_URL=${appUrl}`,
    '-e', `NEXT_PUBLIC_APP_URL=${appUrl}`,
    '-e', `BETTER_AUTH_SECRET=${config.betterAuthSecret}`,
    '-e', `ENCRYPTION_KEY=${config.encryptionKey}`,
  ]
  const command = [
    'docker', 'run', '-d', '--name', config.appContainer,
    '--network', config.networkName,
    '-p', portMapping,
    ...envVars,
    config.appImage,
  ]
  return await runCommand(command)
}

/**
 * Prints success message and stop instructions.
 * @param config - Configuration object.
 */
export function printSuccess(config: Config): void {
  console.log(chalk.green(`✅ Sim is now running at ${chalk.bold(`http://localhost:${config.port}`)}`))
  console.log(chalk.green(`✅ Realtime server is running at ${chalk.bold(`http://localhost:${config.realtimePort}`)}`))
  const stopCmd = `docker stop ${config.appContainer} ${config.dbContainer} ${config.realtimeContainer}`
  console.log(chalk.yellow(`🛑 To stop all containers, run: ${chalk.bold(stopCmd)}`))
  
  // Warn if secrets were auto-generated (not provided via env vars)
  const hasEnvSecrets = process.env.BETTER_AUTH_SECRET && process.env.ENCRYPTION_KEY
  if (!hasEnvSecrets) {
    console.log(chalk.yellow('⚠️  Auto-generated secrets are for development only. Set BETTER_AUTH_SECRET and ENCRYPTION_KEY env vars for production.'))
  }
}

/**
 * Sets up signal handlers for graceful shutdown.
 * @param config - Configuration object.
 */
export function setupShutdownHandlers(config: Config): void {
  const signals = ['SIGINT', 'SIGTERM']
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const shutdown = async (signal: string) => {
    console.log(chalk.yellow(`\n🛑 Received ${signal}. Stopping Sim...`))
    await Promise.all([
      stopAndRemoveContainer(config.appContainer),
      stopAndRemoveContainer(config.realtimeContainer),
      stopAndRemoveContainer(config.dbContainer),
    ])
    console.log(chalk.green('✅ Sim has been stopped gracefully.'))
    rl.close()
    process.exit(0)
  }

  rl.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  // Handle uncaught exceptions
  process.on('uncaughtException', (err) => {
    console.error(chalk.red('❌ Uncaught Exception:'), err)
    shutdown('uncaughtException')
  })
}

/**
 * Main entry point.
 */
export async function main(): Promise<void> {
  const opts = program.parse().opts()
  const config: Config = {
    ...DEFAULT_CONFIG,
    port: parseInt(opts.port as string, 10),
    realtimePort: parseInt(opts.realtimePort as string, 10),
    dataDir: opts.dataDir as string,
    pullImages: !(opts.noPull as boolean),
    yes: opts.yes as boolean,
    betterAuthSecret: process.env.BETTER_AUTH_SECRET || generateSecret(),
    encryptionKey: process.env.ENCRYPTION_KEY || generateSecret(),
  } as Config

  // Validation
  if (isNaN(config.port) || config.port < 1 || config.port > 65535) {
    console.error(chalk.red('❌ Invalid port. Must be between 1 and 65535.'))
    process.exit(1)
  }
  if (isNaN(config.realtimePort) || config.realtimePort < 1 || config.realtimePort > 65535) {
    console.error(chalk.red('❌ Invalid realtime port. Must be between 1 and 65535.'))
    process.exit(1)
  }
  if (config.port === config.realtimePort) {
    console.error(chalk.red('❌ App port and Realtime port must be different.'))
    process.exit(1)
  }
  if (!config.betterAuthSecret || config.betterAuthSecret.length < 32) {
    console.error(chalk.red('❌ BETTER_AUTH_SECRET must be at least 32 characters. Set BETTER_AUTH_SECRET env var.'))
    process.exit(1)
  }
  if (!config.encryptionKey || config.encryptionKey.length < 32) {
    console.error(chalk.red('❌ ENCRYPTION_KEY must be at least 32 characters. Set ENCRYPTION_KEY env var.'))
    process.exit(1)
  }

  // Check port availability if not --yes
  if (!config.yes) {
    const appAvailable = await isPortAvailable(config.port)
    const realtimeAvailable = await isPortAvailable(config.realtimePort)
    if (!appAvailable || !realtimeAvailable) {
      console.error(chalk.red(`❌ Port ${!appAvailable ? config.port : config.realtimePort} is already in use.`))
      process.exit(1)
    }
  }

  console.log(chalk.blue('🚀 Starting Sim...'))

  // Check Docker
  if (!(await isDockerRunning())) {
    console.error(chalk.red('❌ Docker is not running or not installed. Please start Docker and try again.'))
    process.exit(1)
  }

  // Pull images
  if (config.pullImages) {
    const pullPromises = [
      config.dbImage,
      config.migrationsImage,
      config.realtimeImage,
      config.appImage,
    ].map(pullImage)
    const results = await Promise.allSettled(pullPromises)
    if (results.some(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value))) {
      console.error(chalk.red('❌ Failed to pull one or more images.'))
      process.exit(1)
    }
  }

  // Ensure network
  if (!(await ensureNetworkExists(config.networkName))) {
    console.error(chalk.red('❌ Failed to ensure Docker network.'))
    process.exit(1)
  }

  // Cleanup
  await cleanupExistingContainers(config)

  // Ensure data dir
  if (!ensureDataDir(config.dataDir)) {
    process.exit(1)
  }

  // Start DB
  if (!(await startDatabase(config))) {
    console.error(chalk.red('❌ Failed to start PostgreSQL.'))
    process.exit(1)
  }

  // Wait for DB
  if (!(await waitForPgReady(config.dbContainer))) {
    console.error(chalk.red('❌ PostgreSQL failed to become ready within 30s.'))
    process.exit(1)
  }

  // Run migrations
  if (!(await runMigrations(config))) {
    console.error(chalk.red('❌ Failed to run migrations.'))
    process.exit(1)
  }

  // Start Realtime
  if (!(await startRealtime(config))) {
    console.error(chalk.red('❌ Failed to start Realtime Server.'))
    process.exit(1)
  }

  // Start App
  if (!(await startApp(config))) {
    console.error(chalk.red('❌ Failed to start Sim application.'))
    process.exit(1)
  }

  printSuccess(config)
  setupShutdownHandlers(config)

  // Keep process alive
  process.stdin.resume()
}

// Only run main if this is the main module (not during testing)
// Check if running directly (not being imported for testing)
if (process.env.NODE_ENV !== 'test') {
  main().catch((error) => {
    console.error(chalk.red('❌ An unexpected error occurred:'), error)
    process.exit(1)
  })
}
