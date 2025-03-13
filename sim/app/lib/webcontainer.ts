import { WebContainer } from '@webcontainer/api'
import { auth } from '@webcontainer/api'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('WebContainer')

// Singleton instance of WebContainer
let webcontainerInstance: WebContainer | null = null
let isBooting = false
let bootPromise: Promise<WebContainer> | null = null

/**
 * Checks if the browser environment supports WebContainers
 */
function isCrossOriginIsolated(): boolean {
  if (typeof window === 'undefined') return false
  return !!window.crossOriginIsolated
}

/**
 * Check if we're running in the browser
 */
function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

/**
 * Initialize WebContainer authentication
 */
async function initializeAuth() {
  if (!isBrowser()) return

  try {
    await auth.init({
      clientId: process.env.WEBCONTAINER_CLIENT_ID || '',
      scope: '',
    })
  } catch (error) {
    logger.error('Failed to initialize WebContainer auth:', { error })
    throw error
  }
}

/**
 * Initializes a WebContainer instance if one doesn't already exist
 * @returns Promise<WebContainer>
 */
export async function getWebContainer(): Promise<WebContainer> {
  // Only attempt WebContainer initialization in browser
  if (!isBrowser()) {
    throw new Error('WebContainer can only be initialized in browser environments')
  }

  // Return existing instance if available
  if (webcontainerInstance) {
    return webcontainerInstance
  }

  // Return existing boot promise if already booting
  if (isBooting && bootPromise) {
    return bootPromise
  }

  // Check if cross-origin isolation is enabled
  if (!isCrossOriginIsolated()) {
    logger.warn('Cross-Origin Isolation is not enabled. WebContainers require COOP/COEP headers.')
    throw new Error(
      'WebContainers require cross-origin isolation. Please restart the server for changes to take effect.'
    )
  }

  // Set flag and create boot promise
  isBooting = true
  bootPromise = (async () => {
    try {
      await initializeAuth()

      // Boot a new WebContainer instance
      webcontainerInstance = await WebContainer.boot({
        // COEP configuration
        coep: 'require-corp',
        workdirName: 'sim-studio',
        // Enable debugging
        forwardPreviewErrors: true,
      })

      // Set up a basic project with a package.json
      await setupBaseFileSystem(webcontainerInstance)

      return webcontainerInstance
    } catch (error) {
      logger.error('WebContainer boot error:', { error })
      isBooting = false
      bootPromise = null
      throw error
    }
  })()

  return bootPromise
}

/**
 * Sets up the base file system for the WebContainer
 */
async function setupBaseFileSystem(container: WebContainer): Promise<void> {
  await container.mount({
    'package.json': {
      file: {
        contents: JSON.stringify(
          {
            name: 'sim-studio-execution',
            type: 'module',
            version: '1.0.0',
            description: 'Sim Studio Code Execution Environment',
            dependencies: {},
          },
          null,
          2
        ),
      },
    },
    'README.md': {
      file: {
        contents:
          '# Sim Studio Code Execution\n\nThis is a code execution environment for Sim Studio.',
      },
    },
  })
}

/**
 * Parse imports from code and install required packages
 */
async function installDependencies(container: WebContainer, code: string): Promise<void> {
  // Simple regex to find import statements
  const importRegex =
    /import\s+?(?:(?:(?:[\w*\s{},]*)\s+from\s+?)|)(?:(?:"(?:[^"]*)")|(?:'([^']*)'))[^;]*/g
  const matches = code.match(importRegex) || []

  const packages = new Set<string>()

  // Extract package names from import statements
  for (const match of matches) {
    const packageMatch = match.match(/from\s+['"]([^@\s'"]+)/)
    if (packageMatch && packageMatch[1] && !packageMatch[1].startsWith('.')) {
      packages.add(packageMatch[1])
    }
  }

  if (packages.size > 0) {
    // Install each package
    const installProcess = await container.spawn('npm', ['install', ...Array.from(packages)])
    const installExit = await installProcess.exit
    if (installExit !== 0) {
      throw new Error('Failed to install dependencies')
    }
  }
}

/**
 * Execute code in a WebContainer
 */
export async function executeCode(
  code: string,
  params: Record<string, any> = {},
  timeout: number = 5000
): Promise<{
  success: boolean
  output: {
    result: any
    stdout: string
    executionTime: number
  }
  error?: string
}> {
  const startTime = Date.now()
  let process: any = null
  let stdout = ''
  let result: any = null

  try {
    // Get or initialize WebContainer
    const webcontainer = await getWebContainer()

    // Install any required dependencies
    await installDependencies(webcontainer, code)

    // Split imports from the rest of the code
    const importRegex =
      /^import\s+?(?:(?:(?:[\w*\s{},]*)\s+from\s+?)|)(?:(?:"(?:[^"]*)")|(?:'([^']*)'))[^;]*;?\s*/gm
    const imports = []
    let remainingCode = code

    // More carefully extract imports to prevent consuming the entire code
    let match
    let codeLines = code.split('\n')
    let importLines = []

    // Find import lines
    for (let i = 0; i < codeLines.length; i++) {
      if (codeLines[i].trim().startsWith('import ')) {
        importLines.push(i)
      }
    }

    // Extract imports and remaining code separately
    if (importLines.length > 0) {
      imports.push(...importLines.map((idx) => codeLines[idx]))
      remainingCode = codeLines.filter((_, idx) => !importLines.includes(idx)).join('\n')
    }

    // Create the module file with proper structure
    const moduleCode = `
      ${imports.join('\n')}
      
      // Access to params
      const params = ${JSON.stringify(params)};
      
      // Capture return values
      let __result;
      
      // Execute code and capture result
      __result = await (async () => {
        ${remainingCode}
      })();
      
      // Print the result to stdout for capture
      if (__result !== undefined) {
        console.log('__RESULT_START__');
        console.log(JSON.stringify(__result));
        console.log('__RESULT_END__');
      }
      
      // Ensure process exits after completion
      process.exit(0);
    `

    // Mount the file as an ES module
    await webcontainer.fs.writeFile('/code.mjs', moduleCode)

    // Set up stdout capture
    let processCompleted = false

    // Run the code with Node.js in ES module mode
    process = await webcontainer.spawn('node', ['code.mjs'])

    // Create a promise that resolves when we have our result
    const resultPromise = new Promise<void>((resolve, reject) => {
      // Collect output
      process.output.pipeTo(
        new WritableStream({
          write(data) {
            stdout += data

            // Check for result markers
            if (stdout.includes('__RESULT_START__') && stdout.includes('__RESULT_END__')) {
              try {
                const resultStart = stdout.indexOf('__RESULT_START__') + '__RESULT_START__'.length
                const resultEnd = stdout.indexOf('__RESULT_END__')
                const resultJson = stdout.substring(resultStart, resultEnd).trim()

                if (resultJson) {
                  result = JSON.parse(resultJson)
                }

                // Don't resolve yet - wait for process to exit
              } catch (error) {
                logger.error('Failed to parse result', { error })
                reject(error)
              }
            }
          },
        })
      )

      // Handle process exit
      process.exit.then((code: number) => {
        processCompleted = true
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`Process exited with code ${code}`))
        }
      })
    })

    // Set up error handling
    const errorPromise = new Promise<void>((_, reject) => {
      process.stderr.pipeTo(
        new WritableStream({
          write(data) {
            logger.error('WebContainer executeCode - Process error:', { data })
            stdout += `ERROR: ${data}\n`
          },
        })
      )
    })

    // Set up timeout
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => {
        if (!processCompleted) {
          logger.error('WebContainer executeCode - Process timed out after', timeout, 'ms')
          reject(new Error(`Execution timed out after ${timeout}ms`))
        }
      }, timeout)
    })

    // Wait for either completion or timeout
    await Promise.race([resultPromise, errorPromise, timeoutPromise])

    const executionTime = Date.now() - startTime

    // Clean the stdout from our internal markers and result JSON
    const cleanedStdout = stdout
      .replace(/\r?\n?__RESULT_START__\r?\n?[\s\S]*?__RESULT_END__\r?\n?/g, '')
      .trim()

    return {
      success: true,
      output: {
        result,
        stdout: cleanedStdout,
        executionTime,
      },
    }
  } catch (error: any) {
    logger.error('WebContainer executeCode - Execution failed:', {
      error: error.message,
      name: error.name,
      stack: error.stack,
      stdout: stdout || 'No stdout',
    })

    // Try to kill the process if it's still running
    if (process) {
      try {
        await process.kill()
      } catch (killError) {
        logger.error('WebContainer executeCode - Failed to kill process:', { killError })
      }
    }

    // Clean stdout before returning, even in error case
    let cleanedStdout = ''
    if (stdout) {
      cleanedStdout = stdout
        .replace(/\r?\n?__RESULT_START__\r?\n?[\s\S]*?__RESULT_END__\r?\n?/g, '')
        .trim()
    }

    return {
      success: false,
      error: error.message || 'Unknown error occurred during execution',
      output: {
        result: null,
        stdout: cleanedStdout,
        executionTime: Date.now() - startTime,
      },
    }
  }
}
