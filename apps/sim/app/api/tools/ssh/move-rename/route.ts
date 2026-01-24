import { randomUUID } from 'crypto'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  createSSHConnection,
  escapeShellArg,
  executeSSHCommand,
  sanitizePath,
} from '@/app/api/tools/ssh/utils'

const logger = createLogger('SSHMoveRenameAPI')

const MoveRenameSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive().default(22),
  username: z.string().min(1, 'Username is required'),
  password: z.string().nullish(),
  privateKey: z.string().nullish(),
  passphrase: z.string().nullish(),
  sourcePath: z.string().min(1, 'Source path is required'),
  destinationPath: z.string().min(1, 'Destination path is required'),
  overwrite: z.boolean().default(false),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized SSH move/rename attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const params = MoveRenameSchema.parse(body)

    // Validate SSH authentication
    if (!params.password && !params.privateKey) {
      return NextResponse.json(
        { error: 'Either password or privateKey must be provided' },
        { status: 400 }
      )
    }

    logger.info(
      `[${requestId}] Moving ${params.sourcePath} to ${params.destinationPath} on ${params.host}:${params.port}`
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
      const sourcePath = sanitizePath(params.sourcePath)
      const destPath = sanitizePath(params.destinationPath)
      const escapedSource = escapeShellArg(sourcePath)
      const escapedDest = escapeShellArg(destPath)

      const sourceCheck = await executeSSHCommand(
        client,
        `test -e '${escapedSource}' && echo "exists"`
      )
      if (sourceCheck.stdout.trim() !== 'exists') {
        return NextResponse.json(
          { error: `Source path does not exist: ${sourcePath}` },
          { status: 404 }
        )
      }

      if (!params.overwrite) {
        const destCheck = await executeSSHCommand(
          client,
          `test -e '${escapedDest}' && echo "exists"`
        )
        if (destCheck.stdout.trim() === 'exists') {
          return NextResponse.json(
            { error: `Destination already exists and overwrite is disabled: ${destPath}` },
            { status: 409 }
          )
        }
      }

      const command = params.overwrite
        ? `mv -f '${escapedSource}' '${escapedDest}'`
        : `mv '${escapedSource}' '${escapedDest}'`
      const result = await executeSSHCommand(client, command)

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || 'Failed to move/rename')
      }

      logger.info(`[${requestId}] Successfully moved ${sourcePath} to ${destPath}`)

      return NextResponse.json({
        success: true,
        sourcePath,
        destinationPath: destPath,
        message: `Successfully moved ${sourcePath} to ${destPath}`,
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
    logger.error(`[${requestId}] SSH move/rename failed:`, error)

    return NextResponse.json({ error: `SSH move/rename failed: ${errorMessage}` }, { status: 500 })
  }
}
