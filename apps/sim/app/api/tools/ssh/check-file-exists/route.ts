import { randomUUID } from 'crypto'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import type { Client, SFTPWrapper, Stats } from 'ssh2'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import {
  createSSHConnection,
  getFileType,
  parsePermissions,
  sanitizePath,
} from '@/app/api/tools/ssh/utils'

const logger = createLogger('SSHCheckFileExistsAPI')

const CheckFileExistsSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive().default(22),
  username: z.string().min(1, 'Username is required'),
  password: z.string().nullish(),
  privateKey: z.string().nullish(),
  passphrase: z.string().nullish(),
  path: z.string().min(1, 'Path is required'),
  type: z.enum(['file', 'directory', 'any']).default('any'),
})

function getSFTP(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) {
        reject(err)
      } else {
        resolve(sftp)
      }
    })
  })
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized SSH check file exists attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const params = CheckFileExistsSchema.parse(body)

    if (!params.password && !params.privateKey) {
      return NextResponse.json(
        { error: 'Either password or privateKey must be provided' },
        { status: 400 }
      )
    }

    logger.info(
      `[${requestId}] Checking if path exists: ${params.path} on ${params.host}:${params.port}`
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
      const sftp = await getSFTP(client)
      const filePath = sanitizePath(params.path)

      const stats = await new Promise<Stats | null>((resolve) => {
        sftp.stat(filePath, (err, stats) => {
          if (err) {
            resolve(null)
          } else {
            resolve(stats)
          }
        })
      })

      if (!stats) {
        logger.info(`[${requestId}] Path does not exist: ${filePath}`)
        return NextResponse.json({
          exists: false,
          type: 'not_found',
          message: `Path does not exist: ${filePath}`,
        })
      }

      const fileType = getFileType(stats)

      // Check if the type matches the expected type
      if (params.type !== 'any' && fileType !== params.type) {
        logger.info(`[${requestId}] Path exists but is not a ${params.type}: ${filePath}`)
        return NextResponse.json({
          exists: false,
          type: fileType,
          size: stats.size,
          permissions: parsePermissions(stats.mode),
          modified: new Date((stats.mtime || 0) * 1000).toISOString(),
          message: `Path exists but is a ${fileType}, not a ${params.type}`,
        })
      }

      logger.info(`[${requestId}] Path exists: ${filePath} (${fileType})`)

      return NextResponse.json({
        exists: true,
        type: fileType,
        size: stats.size,
        permissions: parsePermissions(stats.mode),
        modified: new Date((stats.mtime || 0) * 1000).toISOString(),
        message: `Path exists: ${filePath} (${fileType})`,
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
    logger.error(`[${requestId}] SSH check file exists failed:`, error)

    return NextResponse.json(
      { error: `SSH check file exists failed: ${errorMessage}` },
      { status: 500 }
    )
  }
}
