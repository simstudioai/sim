import { randomUUID } from 'crypto'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { createSSHConnection, executeSSHCommand, sanitizeCommand } from '@/app/api/tools/ssh/utils'

const logger = createLogger('SSHExecuteCommandAPI')

const ExecuteCommandSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive().default(22),
  username: z.string().min(1, 'Username is required'),
  password: z.string().nullish(),
  privateKey: z.string().nullish(),
  passphrase: z.string().nullish(),
  command: z.string().min(1, 'Command is required'),
  workingDirectory: z.string().nullish(),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized SSH execute command attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const params = ExecuteCommandSchema.parse(body)

    if (!params.password && !params.privateKey) {
      return NextResponse.json(
        { error: 'Either password or privateKey must be provided' },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Executing SSH command on ${params.host}:${params.port}`)

    const client = await createSSHConnection({
      host: params.host,
      port: params.port,
      username: params.username,
      password: params.password,
      privateKey: params.privateKey,
      passphrase: params.passphrase,
    })

    try {
      let command = sanitizeCommand(params.command)
      if (params.workingDirectory) {
        command = `cd "${params.workingDirectory}" && ${command}`
      }

      const result = await executeSSHCommand(client, command)

      logger.info(`[${requestId}] Command executed successfully with exit code ${result.exitCode}`)

      return NextResponse.json({
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        success: result.exitCode === 0,
        message: `Command executed with exit code ${result.exitCode}`,
      })
    } finally {
      client.end()
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`[${requestId}] Invalid request data`, { errors: error.errors })
      return NextResponse.json(
        { error: 'Invalid request data', details: error.errors },
        { status: 400 }
      )
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    logger.error(`[${requestId}] SSH command execution failed:`, error)

    return NextResponse.json(
      { error: `SSH command execution failed: ${errorMessage}` },
      { status: 500 }
    )
  }
}
