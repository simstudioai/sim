import path from 'path'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import { createSftpConnection, getSftp, isPathSafe, sanitizePath } from '@/app/api/tools/sftp/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('SftpDownloadAPI')

const DownloadSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive().default(22),
  username: z.string().min(1, 'Username is required'),
  password: z.string().nullish(),
  privateKey: z.string().nullish(),
  passphrase: z.string().nullish(),
  remotePath: z.string().min(1, 'Remote path is required'),
  encoding: z.enum(['utf-8', 'base64']).default('utf-8'),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized SFTP download attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated SFTP download request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const body = await request.json()
    const params = DownloadSchema.parse(body)

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

      const stats = await new Promise<{ size: number }>((resolve, reject) => {
        sftp.stat(remotePath, (err, stats) => {
          if (err) {
            if (err.message.includes('No such file')) {
              reject(new Error(`File not found: ${remotePath}`))
            } else {
              reject(err)
            }
          } else {
            resolve(stats)
          }
        })
      })

      const maxSize = 50 * 1024 * 1024
      if (stats.size > maxSize) {
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2)
        return NextResponse.json(
          { success: false, error: `File size (${sizeMB}MB) exceeds download limit of 50MB` },
          { status: 400 }
        )
      }

      logger.info(`[${requestId}] Downloading file ${remotePath} (${stats.size} bytes)`)

      const chunks: Buffer[] = []
      await new Promise<void>((resolve, reject) => {
        const readStream = sftp.createReadStream(remotePath)

        readStream.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })

        readStream.on('end', () => resolve())
        readStream.on('error', reject)
      })

      const buffer = Buffer.concat(chunks)
      const fileName = path.basename(remotePath)
      const extension = getFileExtension(fileName)
      const mimeType = getMimeTypeFromExtension(extension)

      let content: string
      if (params.encoding === 'base64') {
        content = buffer.toString('base64')
      } else {
        content = buffer.toString('utf-8')
      }

      logger.info(`[${requestId}] Downloaded ${fileName} (${buffer.length} bytes)`)

      return NextResponse.json({
        success: true,
        fileName,
        file: {
          name: fileName,
          mimeType,
          data: buffer.toString('base64'),
          size: buffer.length,
        },
        content,
        size: buffer.length,
        encoding: params.encoding,
        message: `Successfully downloaded ${fileName}`,
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
    logger.error(`[${requestId}] SFTP download failed:`, error)

    return NextResponse.json({ error: `SFTP download failed: ${errorMessage}` }, { status: 500 })
  }
}
