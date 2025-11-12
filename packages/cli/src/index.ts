#!/usr/bin/env node

import { execSync, spawn } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
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

program.name('simstudio').description('Run Sim using Docker').version('0.1.0')

program
  .option('-p, --port <port>', 'Port to run Sim on', DEFAULT_PORT)
  .option('-y, --yes', 'Skip interactive prompts and use defaults')
  .option('--no-pull', 'Skip pulling the latest Docker images')

const mcp = program.command('mcp').description('MCP server utilities')

mcp
  .command('init [name]')
  .description('Scaffold a starter MCP server project')
  .option('-d, --dir <dir>', 'Target directory (defaults to current working directory)', process.cwd())
  .option('-f, --force', 'Overwrite existing files', false)
  .option('-t, --template <template>', 'Reserved for future templates', 'web-scraper')
  .action(async (name: string | undefined, cmdOptions: { dir?: string; force?: boolean }) => {
    try {
      await scaffoldMcpProject(name || 'sim-hosted-server', cmdOptions)
    } catch (error) {
      console.error(chalk.red('�?O Failed to scaffold MCP server:'), error)
      process.exit(1)
    }
  })

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

function slugifyProjectName(name: string) {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized.length > 0 ? normalized : 'sim-hosted-server'
}

function createFile(filePath: string, contents: string) {
  writeFileSync(filePath, contents, { encoding: 'utf8' })
}

async function scaffoldMcpProject(
  name: string,
  options: { dir?: string; template?: string; force?: boolean }
) {
  const slug = slugifyProjectName(name)
  const targetRoot = resolve(options.dir || process.cwd())
  const projectDir = join(targetRoot, slug)

  if (existsSync(projectDir) && !options.force) {
    throw new Error(
      `Directory ${projectDir} already exists. Re-run with --force to overwrite its contents.`
    )
  }

  mkdirSync(projectDir, { recursive: true })
  mkdirSync(join(projectDir, 'src'), { recursive: true })

  const packageJson = {
    name: slug,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'tsx watch src/server.ts',
      build: 'tsc -p tsconfig.json',
      start: 'node dist/server.js',
    },
    dependencies: {
      '@modelcontextprotocol/sdk': '^0.3.2',
      'cross-fetch': '^4.0.0',
    },
    devDependencies: {
      tsx: '^4.7.0',
      typescript: '^5.7.3',
    },
  }

  const tsconfig = {
    compilerOptions: {
      target: 'ES2021',
      module: 'ESNext',
      moduleResolution: 'Node',
      esModuleInterop: true,
      strict: true,
      skipLibCheck: true,
      outDir: 'dist',
    },
    include: ['src'],
  }

  const serverSource = `import { Server } from '@modelcontextprotocol/sdk/server'
import fetch from 'cross-fetch'

type SearchResult = {
  title: string
  url: string
  summary?: string
  score?: number
}

const server = new Server({
  name: '${name}',
  version: '0.1.0',
})

server.tool('reddit.search', {
  description: 'Search public Reddit posts and comments without authentication.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search keywords' },
      limit: { type: 'number', minimum: 1, maximum: 25, default: 5 },
    },
    required: ['query'],
  },
  handler: async (input): Promise<{ results: SearchResult[] }> => {
    const target = \`https://www.reddit.com/search.json?q=\${encodeURIComponent(
      input.query
    )}&limit=\${input.limit ?? 5}&sort=new\`
    const response = await fetch(target, { headers: { 'User-Agent': 'sim-hosted-mcp' } })
    const data = (await response.json()) as any

    const results =
      data?.data?.children?.map((item: any) => ({
        title: item.data?.title,
        url: \`https://reddit.com\${item.data?.permalink}\`,
        score: item.data?.score,
        summary: item.data?.selftext?.slice(0, 280),
      })) ?? []

    return { results }
  },
})

server.tool('arxiv.search', {
  description: 'Search arXiv papers and return lightweight summaries.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Terms to search for' },
      maxResults: { type: 'number', minimum: 1, maximum: 10, default: 3 },
    },
    required: ['query'],
  },
  handler: async (input): Promise<{ results: SearchResult[] }> => {
    const maxResults = input.maxResults ?? 3
    const apiUrl = \`https://export.arxiv.org/api/query?search_query=all:\${encodeURIComponent(
      input.query
    )}&start=0&max_results=\${maxResults}\`
    const response = await fetch(apiUrl)
    const xml = await response.text()
    const entries = xml.split('<entry>').slice(1)

    const results = entries.map((entry) => {
      const title = entry.split('<title>')[1]?.split('</title>')[0]?.trim()
      const summary = entry.split('<summary>')[1]?.split('</summary>')[0]?.trim()
      const link = entry.split('<link href="')[1]?.split('"')[0]
      return {
        title,
        summary,
        url: link,
      }
    })

    return { results }
  },
})

server.listen()`

  const readme = `# ${name}

This project was created with \`simstudio mcp init\` and contains a ready-to-deploy MCP server that can
scrape Reddit, summarise arXiv preprints, or be extended with YouTube transcripts and Substack ingestion.

## Quickstart

\`\`\`bash
npm install
npm run dev
\`\`\`

Update \`src/server.ts\` with your own tools, then run \`npm run build && npm start\` to host it locally
or push it to the Sim hosted MCP platform.\n`

  createFile(join(projectDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
  createFile(join(projectDir, 'tsconfig.json'), `${JSON.stringify(tsconfig, null, 2)}\n`)
  createFile(join(projectDir, 'README.md'), readme)
  createFile(join(projectDir, 'src', 'server.ts'), `${serverSource}\n`)

  console.log(chalk.green(`�o. Created MCP project at ${projectDir}`))
  console.log(
    chalk.blue(
      `Next steps:\n  cd ${projectDir}\n  npm install\n  npm run dev\n\nDeploy with the workspace UI or the new hosted deployments tab.`
    )
  )
}

async function startSim(options: { port?: string; pull?: boolean }) {

  console.log(chalk.blue('🚀 Starting Sim...'))

  // Check if Docker is installed and running
  const dockerRunning = await isDockerRunning()
  if (!dockerRunning) {
    console.error(
      chalk.red('❌ Docker is not running or not installed. Please start Docker and try again.')
    )
    process.exit(1)
  }

  // Use port from options, with 3000 as default
  const port = options.port || DEFAULT_PORT

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
    'BETTER_AUTH_SECRET=your_auth_secret_here',
    '-e',
    'ENCRYPTION_KEY=your_encryption_key_here',
    'ghcr.io/simstudioai/simstudio:latest',
  ])

  if (!appSuccess) {
    console.error(chalk.red('❌ Failed to start Sim'))
    process.exit(1)
  }

  console.log(chalk.green(`✅ Sim is now running at ${chalk.bold(`http://localhost:${port}`)}`))
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


program.action(async () => {
  try {
    await startSim(program.opts())
  } catch (error) {
    console.error(chalk.red('??O An error occurred:'), error)
    process.exit(1)
  }
})

program.parseAsync(process.argv)
