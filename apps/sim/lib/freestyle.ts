import { FreestyleSandboxes } from 'freestyle-sandboxes'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('Freestyle')

// Singleton instance of FreestyleSandboxes
let freestyleInstance: FreestyleSandboxes | null = null

/**
 * Get or initialize a Freestyle client
 */
export async function getFreestyleClient(): Promise<FreestyleSandboxes> {
  if (freestyleInstance) {
    return freestyleInstance
  }

  try {
    freestyleInstance = new FreestyleSandboxes({
      apiKey: env.FREESTYLE_API_KEY!, // make sure to set this
    })

    return freestyleInstance
  } catch (error) {
    logger.error('Freestyle client initialization error:', { error })
    throw error
  }
}

/**
 * Execute code using Freestyle
 */
export async function executeCode(
  code: string,
  params: Record<string, any> = {},
  timeout = 5000
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

  try {
    // Get or initialize Freestyle client
    const freestyle = await getFreestyleClient()

    // Extract imports to identify required packages
    const importRegex =
      /import\s+?(?:(?:(?:[\w*\s{},]*)\s+from\s+?)|)(?:(?:"([^"]*)")|(?:'([^']*)'))[^;]*/g
    const requireRegex = /const\s+[\w\s{}]*\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g

    const packages: Record<string, string> = {}
    const matches = [...code.matchAll(importRegex), ...code.matchAll(requireRegex)]

    // Extract package names from import statements
    for (const match of matches) {
      const packageName = match[1] || match[2]
      if (packageName && !packageName.startsWith('.') && !packageName.startsWith('/')) {
        // Extract just the package name without version or subpath
        const basePackageName = packageName.split('/')[0]
        packages[basePackageName] = 'latest' // Use latest version
      }
    }

    // Create wrapper code that allows us to pass params and capture the result
    const wrappedCode = `
    export default async () => {
      // Access to params
      const params = ${JSON.stringify(params)};
      
      let result;
      try {
        result = await (async () => {
          ${code}
        })();
        return { success: true, result };
      } catch (error) {
        return { 
          success: false, 
          error: error instanceof Error ? error.message : String(error) 
        };
      }
    }
    `

    // Execute the code with Freestyle
    const result = await freestyle.executeScript(wrappedCode, {
      nodeModules: packages,
      timeout: null,
      // Add environment variables if needed
      envVars: Object.entries(env).reduce(
        (acc, [key, value]) => {
          if (value !== undefined) {
            acc[key] = value as string
          }
          return acc
        },
        {} as Record<string, string>
      ),
    })

    const executionTime = Date.now() - startTime

    // Process result
    if (result && typeof result === 'object' && 'success' in result) {
      if (result.success) {
        return {
          success: true,
          output: {
            result: result.result,
            stdout: '', // Freestyle doesn't provide stdout separately
            executionTime,
          },
        }
      }
      // Handle error case
      const errorResult = result as unknown as { success: false; error: string }
      return {
        success: false,
        error: errorResult.error || 'Execution failed',
        output: {
          result: null,
          stdout: '',
          executionTime,
        },
      }
    }

    // If result doesn't match expected format, return it directly
    return {
      success: true,
      output: {
        result,
        stdout: '',
        executionTime,
      },
    }
  } catch (error: any) {
    logger.error('Freestyle execution failed:', {
      error: error.message,
      name: error.name,
      stack: error.stack,
    })

    return {
      success: false,
      error: error.message || 'Unknown error occurred during execution',
      output: {
        result: null,
        stdout: '',
        executionTime: Date.now() - startTime,
      },
    }
  }
}
