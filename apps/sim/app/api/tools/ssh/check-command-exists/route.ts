import { randomUUID } from 'crypto'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { createSSHConnection, escapeShellArg, executeSSHCommand } from '@/app/api/tools/ssh/utils'

const logger = createLogger('SSHCheckCommandExistsAPI')

const CheckCommandExistsSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive().default(22),
  username: z.string().min(1, 'Username is required'),
  password: z.string().nullish(),
  privateKey: z.string().nullish(),
  passphrase: z.string().nullish(),
  commandName: z.string().min(1, 'Command name is required'),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized SSH check command exists attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const params = CheckCommandExistsSchema.parse(body)

    if (!params.password && !params.privateKey) {
      return NextResponse.json(
        { error: 'Either password or privateKey must be provided' },
        { status: 400 }
      )
    }

    logger.info(
      `[${requestId}] Checking if command '${params.commandName}' exists on ${params.host}:${params.port}`
    )

    const client = await createSSHConnection({
      host: params.host,
      port: params.port,
      username: params.username,
      password: params.password,
      privateKey: params.privateKey,
      passphrase: params.passphrase,
    })

    try {
      const escapedCommand = escapeShellArg(params.commandName)

      const result = await executeSSHCommand(
        client,
        `command -v '${escapedCommand}' 2>/dev/null || which '${escapedCommand}' 2>/dev/null`
      )

      const exists = result.exitCode === 0 && result.stdout.trim().length > 0
      const path = exists ? result.stdout.trim() : undefined

      let version: string | undefined
      if (exists) {
        try {
          const versionResult = await executeSSHCommand(
            client,
            `'${escapedCommand}' --version 2>&1 | head -1 || '${escapedCommand}' -v 2>&1 | head -1`
          )
          if (versionResult.exitCode === 0 && versionResult.stdout.trim()) {
            version = versionResult.stdout.trim()
          }
        } catch {
          // Version check failed, that's okay
        }
      }

      logger.info(
        `[${requestId}] Command '${params.commandName}' ${exists ? 'exists' : 'does not exist'}`
      )

      return NextResponse.json({
        exists,
        path,
        version,
        message: exists
          ? `Command '${params.commandName}' found at ${path}`
          : `Command '${params.commandName}' not found`,
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
    logger.error(`[${requestId}] SSH check command exists failed:`, error)

    return NextResponse.json(
      { error: `SSH check command exists failed: ${errorMessage}` },
      { status: 500 }
    )
  }
}
