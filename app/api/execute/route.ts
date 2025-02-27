import { NextRequest, NextResponse } from 'next/server'
import { Script, createContext } from 'vm'

// Explicitly export allowed methods
export const dynamic = 'force-dynamic' // Disable static optimization
export const runtime = 'nodejs' // Use Node.js runtime

export async function POST(req: NextRequest) {
  const startTime = Date.now()
  let stdout = ''

  try {
    const body = await req.json()

    const { code, params = {}, timeout = 3000 } = body

    // Check if code contains unresolved template variables
    if (code.includes('<') && code.includes('>')) {
      throw new Error(
        'Code contains unresolved template variables. Please ensure all variables are resolved before execution.'
      )
    }

    // Create a secure context with console logging
    const context = createContext({
      params,
      console: {
        log: (...args: any[]) => {
          const logMessage =
            args
              .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
              .join(' ') + '\n'
          stdout += logMessage
        },
        error: (...args: any[]) => {
          const errorMessage =
            args
              .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
              .join(' ') + '\n'
          console.error('❌ Code Console Error:', errorMessage.trim())
          stdout += 'ERROR: ' + errorMessage
        },
      },
    })

    const script = new Script(`
      (async () => {
        try {
          ${code}
        } catch (error) {
          console.error(error);
          throw error;
        }
      })()
    `)

    const result = await script.runInContext(context, {
      timeout,
      displayErrors: true,
    })

    const executionTime = Date.now() - startTime

    const response = {
      success: true,
      output: {
        result,
        stdout,
        executionTime,
      },
    }

    return NextResponse.json(response)
  } catch (error: any) {
    const executionTime = Date.now() - startTime

    const errorResponse = {
      success: false,
      error: error.message || 'Code execution failed',
      output: {
        result: null,
        stdout,
        executionTime,
      },
    }

    return NextResponse.json(errorResponse, { status: 500 })
  }
}
