#!/usr/bin/env node

import { Command } from 'commander'
import inquirer from 'inquirer'
import { execSync } from 'child_process'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, writeFileSync } from 'fs'
import chalk from 'chalk'
import updateNotifier from 'update-notifier'
import open from 'open'
import pkg from '../package.json' with { type: 'json' }

// Check for updates
updateNotifier({ pkg }).notify()

interface StartAnswers {
  useDocker: boolean
  port?: string
}

const program = new Command()
const __dirname = fileURLToPath(new URL('.', import.meta.url))

// Helper function to run the start command
async function startSimStudio() {
  console.log(chalk.magenta(`
  ███████╗██╗███╗   ███╗    ███████╗████████╗██╗   ██╗██████╗ ██╗ ██████╗ 
  ██╔════╝██║████╗ ████║    ██╔════╝╚══██╔══╝██║   ██║██╔══██╗██║██╔═══██╗
  ███████╗██║██╔████╔██║    ███████╗   ██║   ██║   ██║██║  ██║██║██║   ██║
  ╚════██║██║██║╚██╔╝██║    ╚════██║   ██║   ██║   ██║██║  ██║██║██║   ██║
  ███████║██║██║ ╚═╝ ██║    ███████║   ██║   ╚██████╔╝██████╔╝██║╚██████╔╝
  ╚══════╝╚═╝╚═╝     ╚═╝    ╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝ 
                                                                         
`))
  console.log(chalk.gray('Lightweight, user-friendly platform for building AI agent workflows\n'))
  
  const answers = await inquirer.prompt<StartAnswers>([
    {
      type: 'confirm',
      name: 'useDocker',
      message: 'Do you want to use Docker? (Recommended)',
      default: true
    },
    {
      type: 'input',
      name: 'port',
      message: 'What port would you like to use?',
      default: '3000',
      validate: (input) => {
        const port = parseInt(input)
        if (isNaN(port)) {
          return 'Please enter a valid number'
        }
        if (port < 1 || port > 65535) {
          return 'Port must be between 1 and 65535'
        }
        return true
      }
    }
  ])

  if (answers.useDocker) {
    // Check if Docker is installed
    try {
      execSync('docker --version', { stdio: 'ignore' })
    } catch (error) {
      console.error(chalk.red('❌ Docker is not installed. Please install Docker first:'))
      console.log(chalk.yellow('  https://docs.docker.com/get-docker/'))
      process.exit(1)
    }

    // Create .env file if it doesn't exist
    const envPath = join(process.cwd(), '.env')
    if (!existsSync(envPath)) {
      console.log(chalk.yellow('Creating .env file...'))
      const envContent = `
DATABASE_URL=postgresql://postgres:postgres@db:5432/simstudio
POSTGRES_URL=postgresql://postgres:postgres@db:5432/simstudio
BETTER_AUTH_URL=http://localhost:${answers.port}
NEXT_PUBLIC_APP_URL=http://localhost:${answers.port}
BETTER_AUTH_SECRET=your_auth_secret_here
ENCRYPTION_KEY=your_encryption_key_here
FREESTYLE_API_KEY=placeholder
GOOGLE_CLIENT_ID=placeholder
GOOGLE_CLIENT_SECRET=placeholder
GITHUB_CLIENT_ID=placeholder
GITHUB_CLIENT_SECRET=placeholder
RESEND_API_KEY=placeholder
`.trim()
      writeFileSync(envPath, envContent)
      console.log(chalk.green('✓ .env file created'))
    }

    // Create docker-compose.yml if it doesn't exist
    const composePath = join(process.cwd(), 'docker-compose.yml')
    if (!existsSync(composePath)) {
      console.log(chalk.yellow('Creating docker-compose.yml...'))
      const composeContent = `
services:
  simstudio:
    image: ghcr.io/simstudioai/sim:latest
    ports:
      - "${answers.port}:3000"
    volumes:
      - ./.env:/app/.env
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/simstudio
      - POSTGRES_URL=postgresql://postgres:postgres@db:5432/simstudio
      - BETTER_AUTH_URL=http://localhost:${answers.port}
      - NEXT_PUBLIC_APP_URL=http://localhost:${answers.port}
    depends_on:
      db:
        condition: service_healthy

  db:
    image: postgres:16
    restart: always
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=simstudio
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:`
      writeFileSync(composePath, composeContent)
      console.log(chalk.green('✓ docker-compose.yml created'))
    }

    // Check if Docker daemon is running
    try {
      console.log(chalk.blue('🔍 Checking Docker daemon...'))
      execSync('docker info', { stdio: 'ignore' })
    } catch (error) {
      console.error(chalk.red('❌ Docker daemon is not running. Please start Docker Desktop or the Docker service.'))
      process.exit(1)
    }

    // Handle Docker network issues
    try {
      console.log(chalk.blue('🔍 Testing Docker networking...'))
      execSync('docker network ls', { stdio: 'ignore' })
    } catch (error) {
      console.error(chalk.red('❌ Docker networking issue detected. Please check your Docker installation.'))
      process.exit(1)
    }

    // Add permission check for Docker socket
    if (process.platform === 'linux') {
      try {
        execSync('ls -l /var/run/docker.sock', { stdio: 'ignore' })
      } catch (error) {
        console.warn(chalk.yellow('⚠️ Could not check Docker socket permissions. You might need to run with sudo.'))
      }
    }

    // Add timeout handling for image pull
    try {
      console.log(chalk.blue('🚚 Pulling latest Docker image...'))
      // Set a timeout and capture output
      const pullProcess = execSync('docker pull ghcr.io/simstudioai/sim:latest', { 
        timeout: 180000, // 3 minutes 
        stdio: 'pipe' 
      })
      console.log(chalk.green('✓ Successfully pulled Docker image'))
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ETIMEDOUT') {
        console.error(chalk.red('❌ Image pull timed out. Check your internet connection.'))
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error(chalk.red('❌ Failed to pull Docker image:'), errorMessage)
        console.log(chalk.yellow('Attempting to use cached image if available...'))
      }
    }

    // Handle database connectivity issues
    setTimeout(() => {
      try {
        execSync('docker compose exec -T db pg_isready -U postgres', { stdio: 'ignore' })
        console.log(chalk.green('✓ Database is ready'))
      } catch (error) {
        console.error(chalk.red('❌ Could not connect to the database. Check the logs with:'))
        console.log(chalk.yellow('  docker compose logs db'))
      }
    }, 10000)

    // Handle port conflicts
    try {
      console.log(chalk.blue(`🔍 Checking if port ${answers.port} is available...`))
      execSync(`lsof -i :${answers.port} || true`, { stdio: 'pipe' }).toString()
      // If we get output, the port is in use
      console.warn(chalk.yellow(`⚠️ Port ${answers.port} may already be in use. This could cause conflicts.`))
    } catch (error) {
      // Port is likely available, which is good
    }

    // Add graceful shutdown handling
    process.on('SIGINT', () => {
      console.log(chalk.blue('\n👋 Shutting down Sim Studio...'))
      try {
        execSync('docker compose down', { stdio: 'inherit' })
        console.log(chalk.green('✓ Shutdown complete'))
      } catch (error) {
        console.error(chalk.red('❌ Error during shutdown:'), error)
      }
      process.exit(0)
    })

    // Start Docker Compose
    try {
      console.log(chalk.blue('🚀 Starting Sim Studio with Docker Compose...'))
      execSync('docker compose up -d', { stdio: 'inherit' })

      // Open browser after a short delay
      setTimeout(() => {
        console.log(chalk.green('✓ Opening Sim Studio in your browser...'))
        open(`http://localhost:${answers.port}`)
      }, 5000)
    } catch (error) {
      console.error(chalk.red('❌ Error starting Sim Studio:'), error)
      console.log(chalk.yellow('\nTroubleshooting tips:'))
      console.log('  1. Make sure Docker is running')
      console.log('  2. Check if port ' + answers.port + ' is available')
      console.log('  3. Try running with a different port')
      console.log('  4. Visit https://github.com/simstudioai/sim for more help')
      process.exit(1)
    }
  } else {
    // Local installation
    try {
      console.log(chalk.blue('📦 Installing dependencies...'))
      execSync('npm install', { stdio: 'inherit' })
      
      console.log(chalk.blue('🚀 Starting Sim Studio...'))
      execSync('npm run dev', { stdio: 'inherit' })

      // Open browser after a short delay
      setTimeout(() => {
        console.log(chalk.green('✓ Opening Sim Studio in your browser...'))
        open('http://localhost:3000')
      }, 5000)
    } catch (error) {
      console.error(chalk.red('❌ Error starting Sim Studio:'), error)
      console.log(chalk.yellow('\nTroubleshooting tips:'))
      console.log('  1. Make sure Node.js 20+ is installed')
      console.log('  2. Check if port 3000 is available')
      console.log('  3. Try running with Docker instead')
      console.log('  4. Visit https://github.com/simstudioai/sim for more help')
      process.exit(1)
    }
  }
}

program
  .name('simstudio')
  .description('CLI tool for Sim Studio - easily start, build and test agent workflows')
  .version(pkg.version)
  .action(startSimStudio) // Run start when no command is specified

// Add explicit start command for backward compatibility
program
  .command('start')
  .description('Start Sim Studio')
  .action(startSimStudio)

program.parse() 