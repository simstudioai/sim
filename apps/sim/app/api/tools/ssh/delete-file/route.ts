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

const logger = createLogger('SSHDeleteFileAPI')

const DeleteFileSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive().default(22),
  username: z.string().min(1, 'Username is required'),
  password: z.string().nullish(),
  privateKey: z.string().nullish(),
  passphrase: z.string().nullish(),
  path: z.string().min(1, 'Path is required'),
  recursive: z.boolean().default(false),
  force: z.boolean().default(false),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized SSH delete file attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const params = DeleteFileSchema.parse(body)

    if (!params.password && !params.privateKey) {
      return NextResponse.json(
        { error: 'Either password or privateKey must be provided' },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Deleting ${params.path} on ${params.host}:${params.port}`)

    const client = await createSSHConnection({
      host: params.host,
      port: params.port,
      username: params.username,
      password: params.password,
      privateKey: params.privateKey,
      passphrase: params.passphrase,
    })

    try {
      const filePath = sanitizePath(params.path)
      const escapedPath = escapeShellArg(filePath)

      const checkResult = await executeSSHCommand(
        client,
        `test -e '${escapedPath}' && echo "exists"`
      )
      if (checkResult.stdout.trim() !== 'exists') {
        return NextResponse.json({ error: `Path does not exist: ${filePath}` }, { status: 404 })
      }

      let command: string
      if (params.recursive) {
        command = params.force ? `rm -rf '${escapedPath}'` : `rm -r '${escapedPath}'`
      } else {
        command = params.force ? `rm -f '${escapedPath}'` : `rm '${escapedPath}'`
      }

      const result = await executeSSHCommand(client, command)

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || 'Failed to delete path')
      }

      logger.info(`[${requestId}] Path deleted successfully: ${filePath}`)

      return NextResponse.json({
        deleted: true,
        path: filePath,
        message: `Successfully deleted: ${filePath}`,
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
    logger.error(`[${requestId}] SSH delete file failed:`, error)

    return NextResponse.json({ error: `SSH delete file failed: ${errorMessage}` }, { status: 500 })
  }
}
