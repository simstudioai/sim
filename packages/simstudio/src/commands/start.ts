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
const STANDALONE_VERSION = '0.1.4'
const DOWNLOAD_URL =
  'https://github.com/simstudioai/sim/releases/latest/download/sim-standalone.tar.gz'
// Add a custom user agent to avoid GitHub API rate limiting
const USER_AGENT = 'SimStudio-CLI'

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
            spinner.fail('Build failed')
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
      spinner.text = 'Setting up Sim Studio...'

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
          console.log(`\n${chalk.blue('ℹ')} Downloading Sim Studio...`)

          await downloadStandaloneApp(spinner, options)
        } catch (error) {
          spinner.fail('Download failed')
          console.log(`\n${chalk.yellow('⚠️')} If you're having network issues, you can try:
  1. Check your internet connection
  2. Try again later
  3. Run Sim Studio directly from a cloned repository`)
          process.exit(1)
        }
      } else {
        spinner.text = 'Using cached version...'
      }

      // Start the standalone app
      spinner.text = 'Starting Sim Studio...'

      // Make sure the standalone directory exists
      if (
        !fs.existsSync(SIM_STANDALONE_DIR) ||
        !fs.existsSync(path.join(SIM_STANDALONE_DIR, 'server.js'))
      ) {
        spinner.fail('Setup incomplete')
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
    spinner.succeed(`Sim Studio started on ${chalk.cyan(`http://localhost:${port}`)}`)
    console.log(`
${chalk.green('✓')} Local storage mode enabled
${chalk.green('✓')} Changes persist between sessions
${chalk.green('✓')} Authentication disabled
${chalk.blue('ℹ')} Create a workflow at ${chalk.cyan(`http://localhost:${port}/w`)}
${chalk.blue('ℹ')} Press ${chalk.bold('Ctrl+C')} to stop the server
`)

    // Auto-open browser to workflow page
    if (!options.noOpen) {
      try {
        // Dynamically import open to avoid adding it as a dependency for production builds
        const open = await import('open').then((m) => m.default)

        // Wait a short time for the server to fully start
        setTimeout(() => {
          open(`http://localhost:${port}/w`)
          console.log(`${chalk.green('✓')} Browser opened to workflow canvas`)
        }, 1000)
      } catch (error) {
        console.log(
          `${chalk.blue('ℹ')} Please navigate to ${chalk.cyan(`http://localhost:${port}/w`)} in your browser`
        )
      }
    }

    // Handle process termination
    process.on('SIGINT', () => {
      console.log(`\n${chalk.blue('ℹ')} Shutting down Sim Studio...`)
      simProcess.kill('SIGINT')
      process.exit(0)
    })

    // Return the process for testing purposes
    return simProcess
  } catch (error) {
    spinner.fail('Failed to start')
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
async function downloadStandaloneApp(spinner: SimpleSpinner, options: StartOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    // Create temp directory
    const tmpDir = path.join(os.tmpdir(), `sim-download-${Date.now()}`)
    fs.mkdirSync(tmpDir, { recursive: true })

    const tarballPath = path.join(tmpDir, 'sim-standalone.tar.gz')

    // Track retry attempts
    let retryCount = 0
    const maxRetries = 3

    // Function to start a fresh download attempt
    const startDownload = (url: string) => {
      // Create a new file stream for each attempt
      const file = createWriteStream(tarballPath)

      if (retryCount > 0) {
        spinner.text = `Downloading Sim Studio... (Attempt ${retryCount + 1}/${maxRetries + 1})`
      } else {
        spinner.text = 'Downloading Sim Studio...'
      }

      // Function to handle the download
      downloadFile(url, 0, file)
    }

    // Function to handle the download
    const downloadFile = (url: string, redirectCount = 0, file: fs.WriteStream) => {
      // Prevent infinite redirects
      if (redirectCount > 5) {
        spinner.fail('Download failed')
        if (options.debug) {
          console.error('Redirect chain exceeded maximum depth')
        }
        return handleError(new Error('Too many redirects'))
      }

      // Set a timeout for the request (15 seconds)
      const request = https
        .get(
          url,
          {
            timeout: 15000,
            headers: {
              'User-Agent': USER_AGENT,
            },
          },
          (response) => {
            // Handle redirects (302, 301, 307, etc.)
            if (
              response.statusCode &&
              response.statusCode >= 300 &&
              response.statusCode < 400 &&
              response.headers.location
            ) {
              // Close the current file stream before following the redirect
              file.close()

              const redirectUrl = response.headers.location.startsWith('http')
                ? response.headers.location
                : new URL(response.headers.location, url).toString()

              // Only show "Following redirects" on the first redirect
              if (redirectCount === 0 && !options.debug) {
                spinner.text = 'Following redirects...'
              }

              // Only log redirect details in debug mode
              if (options.debug) {
                console.log(`Redirect ${redirectCount + 1}: ${url} -> ${redirectUrl}`)
              }

              // Follow the redirect with incremented counter
              downloadFile(redirectUrl, redirectCount + 1, createWriteStream(tarballPath))
              return
            }

            if (response.statusCode !== 200) {
              spinner.fail('Download failed')
              if (options.debug) {
                console.error(`Server returned status code: ${response.statusCode}`)
                console.error('URL that failed:', url)
                console.error('Response headers:', JSON.stringify(response.headers, null, 2))
              }
              file.close()
              return handleError(new Error(`Server returned ${response.statusCode}`))
            }

            // Get content length for progress tracking
            const totalSize = parseInt(response.headers['content-length'] || '0', 10)
            let downloadedSize = 0
            let lastProgressUpdate = Date.now()
            let lastDataReceived = Date.now()
            const startTime = Date.now()

            if (totalSize > 0) {
              spinner.text = `Downloading Sim Studio... (${(totalSize / 1024 / 1024).toFixed(1)} MB)`
            } else {
              spinner.text = 'Downloading Sim Studio...'
            }

            // Track download progress
            response.on('data', (chunk) => {
              downloadedSize += chunk.length
              lastDataReceived = Date.now()

              // Only update the spinner text every 500ms to avoid excessive updates
              const now = Date.now()
              if (now - lastProgressUpdate > 500) {
                lastProgressUpdate = now
                const elapsedSeconds = (now - startTime) / 1000
                const downloadSpeed = downloadedSize / elapsedSeconds / 1024 / 1024 // MB/s

                if (totalSize > 0) {
                  const percent = Math.round((downloadedSize / totalSize) * 100)
                  spinner.text = `Downloading Sim Studio... ${percent}% (${(downloadedSize / 1024 / 1024).toFixed(1)}/${(totalSize / 1024 / 1024).toFixed(1)} MB)`
                } else {
                  spinner.text = `Downloading Sim Studio... ${(downloadedSize / 1024 / 1024).toFixed(1)} MB downloaded`
                }
              }
            })

            // Set up a progress check interval to detect stalled downloads
            const progressInterval = setInterval(() => {
              const timeSinceLastData = Date.now() - lastDataReceived
              if (timeSinceLastData > 10000) {
                // 10 seconds with no data
                clearInterval(progressInterval)
                request.destroy()
                spinner.fail('Download failed')
                handleError(new Error('Download stalled - no data received for 10 seconds'))
              }
            }, 2000)

            response.pipe(file)

            file.on('finish', () => {
              clearInterval(progressInterval)
              file.close()

              // Clear the standalone directory if it exists
              if (fs.existsSync(SIM_STANDALONE_DIR)) {
                fs.rmSync(SIM_STANDALONE_DIR, { recursive: true, force: true })
              }

              // Create the directory
              fs.mkdirSync(SIM_STANDALONE_DIR, { recursive: true })

              spinner.text = 'Extracting files...'

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
                        JSON.stringify({
                          version: STANDALONE_VERSION,
                          date: new Date().toISOString(),
                        })
                      )

                      spinner.succeed('Setup complete')
                      resolve()
                    })
                    .catch((err) => {
                      spinner.fail('Extraction failed')
                      handleError(err)
                    })
                })
                .catch((err) => {
                  spinner.fail('Extraction failed')
                  handleError(err)
                })
            })

            file.on('error', (err) => {
              clearInterval(progressInterval)
              spinner.fail('File error')
              handleError(err)
            })
          }
        )
        .on('error', (err) => {
          spinner.fail('Network error')
          handleError(err)
        })
        .on('timeout', () => {
          request.destroy()
          spinner.fail('Download timed out')
          handleError(new Error('Download timed out after 15 seconds'))
        })
    }

    // Error handler with retry logic
    const handleError = (err: Error) => {
      if (retryCount < maxRetries) {
        retryCount++
        spinner.text = `Retrying download (${retryCount}/${maxRetries})...`

        // Use the same URL but with a delay
        setTimeout(() => startDownload(DOWNLOAD_URL), 1000)
      } else {
        // Clean up
        if (fs.existsSync(tarballPath)) {
          fs.unlinkSync(tarballPath)
        }
        if (fs.existsSync(tmpDir)) {
          fs.rmSync(tmpDir, { recursive: true, force: true })
        }

        reject(err)
      }
    }

    // Start the download process
    startDownload(DOWNLOAD_URL)
  })
}
