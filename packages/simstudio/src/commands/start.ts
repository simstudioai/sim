import chalk from 'chalk'
import { spawn } from 'child_process'
import { execSync } from 'child_process'
import fs from 'fs'
import { createWriteStream } from 'fs'
import https from 'https'
import os from 'os'
import path from 'path'
import { config } from '../utils/config'
import { SimpleSpinner, createSpinner } from '../utils/spinner'

interface StartOptions {
  port: string
  debug: boolean
  noOpen?: boolean // Add option to not open browser
}

// Constants for standalone app
const SIM_HOME_DIR = path.join(os.homedir(), '.sim-studio')
const SIM_STANDALONE_DIR = path.join(SIM_HOME_DIR, 'standalone')
const SIM_VERSION_FILE = path.join(SIM_HOME_DIR, 'version.json')
const DOWNLOAD_URL =
  'https://github.com/simstudioai/sim/releases/latest/download/sim-standalone.tar.gz'
const STANDALONE_VERSION = '0.1.0'

/**
 * Start command that launches Sim Studio using local storage
 */
export async function start(options: StartOptions) {
  // Update config with provided options
  config.set('port', options.port)
  config.set('debug', options.debug)
  config.set('lastRun', new Date().toISOString())

  const port = options.port || '3000'
  const debug = options.debug || false

  // Show starting message
  const spinner = createSpinner(`Starting Sim Studio on port ${port}...`).start()

  try {
    // Set environment variables for using local storage
    const env = {
      ...process.env,
      PORT: port,
      USE_LOCAL_STORAGE: 'true', // Key environment variable to switch to local storage
      NEXT_PUBLIC_USE_LOCAL_STORAGE: 'true', // For client-side code
      DISABLE_DB_SYNC: 'true', // Disable database sync
      DISABLE_AUTH: 'true', // Disable authentication
      NEXT_PUBLIC_DISABLE_AUTH: 'true', // For client-side authentication check
      NODE_ENV: debug ? 'development' : ('production' as const),
      DEBUG: debug ? '*' : undefined,
    }

    // Try to find the main package.json to determine if we're running from within the repo
    // or as an installed npm package
    const isInProjectDirectory = checkIfInProjectDirectory()

    let simProcess

    if (isInProjectDirectory) {
      // Running from within the project directory - we'll use the existing
      // Next.js setup directly
      spinner.text = 'Detected Sim Studio project, starting with local configuration...'

      // When running in dev mode, we need to make sure we're not trying to use static export
      // as it will fail with API routes
      if (debug) {
        spinner.text = 'Starting in development mode with local storage...'
        simProcess = spawn('npm', ['run', 'dev'], {
          env: env as NodeJS.ProcessEnv,
          stdio: 'inherit',
          shell: true,
        })
      } else {
        // In production mode, we'll use the start command which uses the built app
        spinner.text = 'Starting in production mode with local storage...'

        // Build first if needed
        if (!fs.existsSync(path.join(process.cwd(), '.next'))) {
          spinner.text = 'Building Next.js app first...'
          try {
            execSync('npm run build', {
              env: env as NodeJS.ProcessEnv,
              stdio: 'inherit',
            })
          } catch (error) {
            spinner.fail('Failed to build Next.js app')
            console.error(chalk.red('Error:'), error instanceof Error ? error.message : error)
            process.exit(1)
          }
        }

        simProcess = spawn('npm', ['run', 'start'], {
          env: env as NodeJS.ProcessEnv,
          stdio: 'inherit',
          shell: true,
        })
      }
    } else {
      // Running from outside the project via npx - we'll download and start a standalone version
      spinner.text = 'Setting up standalone Sim Studio...'

      // Create the .sim-studio directory if it doesn't exist
      if (!fs.existsSync(SIM_HOME_DIR)) {
        fs.mkdirSync(SIM_HOME_DIR, { recursive: true })
      }

      // Check if we already have the standalone version
      let needsDownload = true

      if (fs.existsSync(SIM_VERSION_FILE)) {
        try {
          const versionInfo = JSON.parse(fs.readFileSync(SIM_VERSION_FILE, 'utf8'))
          if (versionInfo.version === STANDALONE_VERSION) {
            needsDownload = false
          }
        } catch (error) {
          // If there's an error reading the version file, download again
          needsDownload = true
        }
      }

      // Download and extract if needed
      if (needsDownload) {
        try {
          await downloadStandaloneApp(spinner)
        } catch (error) {
          spinner.fail(
            `Failed to download Sim Studio: ${error instanceof Error ? error.message : String(error)}`
          )
          console.log(`\n${chalk.yellow('⚠️')} If you're having network issues, you can try:
  1. Check your internet connection
  2. Try again later
  3. Run Sim Studio directly from a cloned repository`)
          process.exit(1)
        }
      } else {
        spinner.text = 'Using cached Sim Studio standalone version...'
      }

      // Start the standalone app
      spinner.text = 'Starting Sim Studio standalone...'

      // Make sure the standalone directory exists
      if (
        !fs.existsSync(SIM_STANDALONE_DIR) ||
        !fs.existsSync(path.join(SIM_STANDALONE_DIR, 'server.js'))
      ) {
        spinner.fail('Standalone app files are missing. Re-run to download again.')
        // Force a fresh download next time
        if (fs.existsSync(SIM_VERSION_FILE)) {
          fs.unlinkSync(SIM_VERSION_FILE)
        }
        process.exit(1)
      }

      // Start the standalone Node.js server
      const standaloneEnv = {
        ...env,
        SIM_STUDIO_PORT: port,
      }

      simProcess = spawn('node', ['server.js'], {
        cwd: SIM_STANDALONE_DIR,
        env: standaloneEnv as NodeJS.ProcessEnv,
        stdio: 'inherit',
        shell: true,
      })
    }

    // Successful start
    spinner.succeed(`Sim Studio is running on ${chalk.cyan(`http://localhost:${port}`)}`)
    console.log(`
${chalk.green('✓')} Using local storage mode - your data will be stored in the browser
${chalk.green('✓')} Any changes will be persisted between sessions through localStorage
${chalk.green('✓')} Authentication is disabled - you have immediate access to all features
${chalk.yellow('i')} Navigate to ${chalk.cyan(`http://localhost:${port}/w`)} to create a new workflow
${chalk.yellow('i')} Press ${chalk.bold('Ctrl+C')} to stop the server
`)

    // Auto-open browser to workflow page
    if (!options.noOpen) {
      try {
        // Dynamically import open to avoid adding it as a dependency for production builds
        const open = await import('open').then((m) => m.default)

        // Wait a short time for the server to fully start
        setTimeout(() => {
          open(`http://localhost:${port}/w`)
          console.log(`${chalk.green('✓')} Opened browser to workflow canvas`)
        }, 1000)
      } catch (error) {
        console.log(
          `${chalk.yellow('i')} Could not automatically open browser. Please navigate to ${chalk.cyan(`http://localhost:${port}/w`)} manually.`
        )
      }
    }

    // Handle process termination
    process.on('SIGINT', () => {
      console.log(`\n${chalk.yellow('⚠️')} Shutting down Sim Studio...`)
      simProcess.kill('SIGINT')
      process.exit(0)
    })

    // Return the process for testing purposes
    return simProcess
  } catch (error) {
    spinner.fail('Failed to start Sim Studio')
    console.error(chalk.red('Error:'), error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

/**
 * Checks if we're running in a Sim Studio project directory
 */
function checkIfInProjectDirectory(): boolean {
  // Check if we have package.json that looks like a Sim Studio project
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json')

    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))

      // Check if it looks like our project
      if (
        packageJson.name === 'sim' ||
        packageJson.name === 'sim-studio' ||
        (packageJson.dependencies &&
          (packageJson.dependencies['next'] ||
            packageJson.dependencies['@simstudio/cli'] ||
            packageJson.dependencies['sim-studio-cli']))
      ) {
        return true
      }
    }

    // Also check for Next.js app files
    const nextConfigPath = path.join(process.cwd(), 'next.config.js')
    const nextTsConfigPath = path.join(process.cwd(), 'next.config.ts')

    if (fs.existsSync(nextConfigPath) || fs.existsSync(nextTsConfigPath)) {
      return true
    }
  } catch (error) {
    // If we can't read/parse package.json, assume we're not in a project directory
  }

  return false
}

/**
 * Downloads and extracts the standalone app
 */
async function downloadStandaloneApp(spinner: SimpleSpinner): Promise<void> {
  return new Promise((resolve, reject) => {
    // Create temp directory
    const tmpDir = path.join(os.tmpdir(), `sim-download-${Date.now()}`)
    fs.mkdirSync(tmpDir, { recursive: true })

    const tarballPath = path.join(tmpDir, 'sim-standalone.tar.gz')
    const file = createWriteStream(tarballPath)

    spinner.text = 'Downloading Sim Studio...'

    // Download the tarball
    https
      .get(DOWNLOAD_URL, (response) => {
        if (response.statusCode !== 200) {
          spinner.fail(`Failed to download: ${response.statusCode}`)
          return reject(new Error(`Download failed with status code: ${response.statusCode}`))
        }

        response.pipe(file)

        file.on('finish', () => {
          file.close()

          // Clear the standalone directory if it exists
          if (fs.existsSync(SIM_STANDALONE_DIR)) {
            fs.rmSync(SIM_STANDALONE_DIR, { recursive: true, force: true })
          }

          // Create the directory
          fs.mkdirSync(SIM_STANDALONE_DIR, { recursive: true })

          spinner.text = 'Extracting Sim Studio...'

          // Dynamically import tar only when needed
          import('tar')
            .then(({ extract }) => {
              // Extract the tarball
              extract({
                file: tarballPath,
                cwd: SIM_STANDALONE_DIR,
              })
                .then(() => {
                  // Clean up
                  fs.rmSync(tmpDir, { recursive: true, force: true })

                  // Install dependencies if needed
                  if (fs.existsSync(path.join(SIM_STANDALONE_DIR, 'package.json'))) {
                    spinner.text = 'Installing dependencies...'

                    try {
                      execSync('npm install --production', {
                        cwd: SIM_STANDALONE_DIR,
                        stdio: 'ignore',
                      })
                    } catch (error) {
                      spinner.warn('Error installing dependencies, but trying to continue...')
                    }
                  }

                  // Write version file
                  fs.writeFileSync(
                    SIM_VERSION_FILE,
                    JSON.stringify({ version: STANDALONE_VERSION, date: new Date().toISOString() })
                  )

                  spinner.succeed('Sim Studio downloaded successfully')
                  resolve()
                })
                .catch((err) => {
                  spinner.fail('Failed to extract Sim Studio')
                  reject(err)
                })
            })
            .catch((err) => {
              spinner.fail('Failed to load tar module')
              reject(err)
            })
        })
      })
      .on('error', (err) => {
        spinner.fail('Network error')
        reject(err)
      })
  })
}
