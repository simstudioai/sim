import { randomUUID } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { createSSHConnection, executeSSHCommand, sanitizePath } from '@/app/api/tools/ssh/utils'

const logger = createLogger('SSHDeleteFileAPI')

const DeleteFileSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive().default(22),
  username: z.string().min(1, 'Username is required'),
  password: z.string().optional(),
  privateKey: z.string().optional(),
  passphrase: z.string().optional(),
  path: z.string().min(1, 'Path is required'),
  recursive: z.boolean().default(false),
  force: z.boolean().default(false),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  try {
    const body = await request.json()
    const params = DeleteFileSchema.parse(body)

    // Validate authentication
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

      // Check if path exists
      const checkResult = await executeSSHCommand(client, `test -e '${filePath}' && echo "exists"`)
      if (checkResult.stdout.trim() !== 'exists') {
        return NextResponse.json({ error: `Path does not exist: ${filePath}` }, { status: 404 })
      }

      // Build delete command
      let command: string
      if (params.recursive) {
        command = params.force ? `rm -rf '${filePath}'` : `rm -r '${filePath}'`
      } else {
        command = params.force ? `rm -f '${filePath}'` : `rm '${filePath}'`
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
