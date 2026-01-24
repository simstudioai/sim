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

const logger = createLogger('SSHCreateDirectoryAPI')

const CreateDirectorySchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive().default(22),
  username: z.string().min(1, 'Username is required'),
  password: z.string().nullish(),
  privateKey: z.string().nullish(),
  passphrase: z.string().nullish(),
  path: z.string().min(1, 'Path is required'),
  recursive: z.boolean().default(true),
  permissions: z.string().default('0755'),
})

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized SSH create directory attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const params = CreateDirectorySchema.parse(body)

    if (!params.password && !params.privateKey) {
      return NextResponse.json(
        { error: 'Either password or privateKey must be provided' },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Creating directory ${params.path} on ${params.host}:${params.port}`)

    const client = await createSSHConnection({
      host: params.host,
      port: params.port,
      username: params.username,
      password: params.password,
      privateKey: params.privateKey,
      passphrase: params.passphrase,
    })

    try {
      const dirPath = sanitizePath(params.path)
      const escapedPath = escapeShellArg(dirPath)

      const checkResult = await executeSSHCommand(
        client,
        `test -d '${escapedPath}' && echo "exists"`
      )
      const alreadyExists = checkResult.stdout.trim() === 'exists'

      if (alreadyExists) {
        logger.info(`[${requestId}] Directory already exists: ${dirPath}`)
        return NextResponse.json({
          created: false,
          path: dirPath,
          alreadyExists: true,
          message: `Directory already exists: ${dirPath}`,
        })
      }

      const mkdirFlag = params.recursive ? '-p' : ''
      const command = `mkdir ${mkdirFlag} -m ${params.permissions} '${escapedPath}'`
      const result = await executeSSHCommand(client, command)

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || 'Failed to create directory')
      }

      logger.info(`[${requestId}] Directory created successfully: ${dirPath}`)

      return NextResponse.json({
        created: true,
        path: dirPath,
        alreadyExists: false,
        message: `Directory created successfully: ${dirPath}`,
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
    logger.error(`[${requestId}] SSH create directory failed:`, error)

    return NextResponse.json(
      { error: `SSH create directory failed: ${errorMessage}` },
      { status: 500 }
    )
  }
}
