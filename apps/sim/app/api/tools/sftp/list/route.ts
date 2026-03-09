import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  createSftpConnection,
  getFileType,
  getSftp,
  isPathSafe,
  parsePermissions,
  sanitizePath,
} from '@/app/api/tools/sftp/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('SftpListAPI')

const ListSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive().default(22),
  username: z.string().min(1, 'Username is required'),
  password: z.string().nullish(),
  privateKey: z.string().nullish(),
  passphrase: z.string().nullish(),
  remotePath: z.string().min(1, 'Remote path is required'),
  detailed: z.boolean().default(false),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized SFTP list attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated SFTP list request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const body = await request.json()
    const params = ListSchema.parse(body)

    if (!params.password && !params.privateKey) {
      return NextResponse.json(
        { error: 'Either password or privateKey must be provided' },
        { status: 400 }
      )
    }

    if (!isPathSafe(params.remotePath)) {
      logger.warn(`[${requestId}] Path traversal attempt detected in remotePath`)
      return NextResponse.json(
        { error: 'Invalid remote path: path traversal sequences are not allowed' },
        { status: 400 }
      )
    }

    logger.info(`[${requestId}] Connecting to SFTP server ${params.host}:${params.port}`)

    const client = await createSftpConnection({
      host: params.host,
      port: params.port,
      username: params.username,
      password: params.password,
      privateKey: params.privateKey,
      passphrase: params.passphrase,
    })

    try {
      const sftp = await getSftp(client)
      const remotePath = sanitizePath(params.remotePath)

      logger.info(`[${requestId}] Listing directory ${remotePath}`)

      const fileList = await new Promise<Array<{ filename: string; longname: string; attrs: any }>>(
        (resolve, reject) => {
          sftp.readdir(remotePath, (err, list) => {
            if (err) {
              if (err.message.includes('No such file')) {
                reject(new Error(`Directory not found: ${remotePath}`))
              } else {
                reject(err)
              }
            } else {
              resolve(list)
            }
          })
        }
      )

      const entries = fileList
        .filter((item) => item.filename !== '.' && item.filename !== '..')
        .map((item) => {
          const entry: {
            name: string
            type: 'file' | 'directory' | 'symlink' | 'other'
            size?: number
            permissions?: string
            modifiedAt?: string
          } = {
            name: item.filename,
            type: getFileType(item.attrs),
          }

          if (params.detailed) {
            entry.size = item.attrs.size
            entry.permissions = parsePermissions(item.attrs.mode)
            if (item.attrs.mtime) {
              entry.modifiedAt = new Date(item.attrs.mtime * 1000).toISOString()
            }
          }

          return entry
        })

      entries.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1
        if (a.type !== 'directory' && b.type === 'directory') return 1
        return a.name.localeCompare(b.name)
      })

      logger.info(`[${requestId}] Listed ${entries.length} entries in ${remotePath}`)

      return NextResponse.json({
        success: true,
        path: remotePath,
        entries,
        count: entries.length,
        message: `Found ${entries.length} entries in ${remotePath}`,
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
    logger.error(`[${requestId}] SFTP list failed:`, error)

    return NextResponse.json({ error: `SFTP list failed: ${errorMessage}` }, { status: 500 })
  }
}
