import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import {
  createSftpConnection,
  getSftp,
  isPathSafe,
  sanitizeFileName,
  sanitizePath,
  sftpExists,
} from '@/app/api/tools/sftp/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('SftpUploadAPI')

const UploadSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive().default(22),
  username: z.string().min(1, 'Username is required'),
  password: z.string().nullish(),
  privateKey: z.string().nullish(),
  passphrase: z.string().nullish(),
  remotePath: z.string().min(1, 'Remote path is required'),
  files: RawFileInputArraySchema.optional().nullable(),
  fileContent: z.string().nullish(),
  fileName: z.string().nullish(),
  overwrite: z.boolean().default(true),
  permissions: z.string().nullish(),
})

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })

    if (!authResult.success) {
      logger.warn(`[${requestId}] Unauthorized SFTP upload attempt: ${authResult.error}`)
      return NextResponse.json(
        { success: false, error: authResult.error || 'Authentication required' },
        { status: 401 }
      )
    }

    logger.info(`[${requestId}] Authenticated SFTP upload request via ${authResult.authType}`, {
      userId: authResult.userId,
    })

    const body = await request.json()
    const params = UploadSchema.parse(body)

    if (!params.password && !params.privateKey) {
      return NextResponse.json(
        { error: 'Either password or privateKey must be provided' },
        { status: 400 }
      )
    }

    const hasFiles = params.files && params.files.length > 0
    const hasDirectContent = params.fileContent && params.fileName

    if (!hasFiles && !hasDirectContent) {
      return NextResponse.json(
        { error: 'Either files or fileContent with fileName must be provided' },
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
      const uploadedFiles: Array<{ name: string; remotePath: string; size: number }> = []

      if (hasFiles) {
        const rawFiles = params.files!
        logger.info(`[${requestId}] Processing ${rawFiles.length} file(s) for upload`)

        const userFiles = processFilesToUserFiles(rawFiles, requestId, logger)

        const totalSize = userFiles.reduce((sum, file) => sum + file.size, 0)
        const maxSize = 100 * 1024 * 1024

        if (totalSize > maxSize) {
          const sizeMB = (totalSize / (1024 * 1024)).toFixed(2)
          return NextResponse.json(
            { success: false, error: `Total file size (${sizeMB}MB) exceeds limit of 100MB` },
            { status: 400 }
          )
        }

        for (const file of userFiles) {
          try {
            logger.info(
              `[${requestId}] Downloading file for upload: ${file.name} (${file.size} bytes)`
            )
            const buffer = await downloadFileFromStorage(file, requestId, logger)

            const safeFileName = sanitizeFileName(file.name)
            const fullRemotePath = remotePath.endsWith('/')
              ? `${remotePath}${safeFileName}`
              : `${remotePath}/${safeFileName}`

            const sanitizedRemotePath = sanitizePath(fullRemotePath)

            if (!params.overwrite) {
              const exists = await sftpExists(sftp, sanitizedRemotePath)
              if (exists) {
                logger.warn(`[${requestId}] File ${sanitizedRemotePath} already exists, skipping`)
                continue
              }
            }

            await new Promise<void>((resolve, reject) => {
              const writeStream = sftp.createWriteStream(sanitizedRemotePath, {
                mode: params.permissions ? Number.parseInt(params.permissions, 8) : 0o644,
              })

              writeStream.on('error', reject)
              writeStream.on('close', () => resolve())
              writeStream.end(buffer)
            })

            uploadedFiles.push({
              name: safeFileName,
              remotePath: sanitizedRemotePath,
              size: buffer.length,
            })

            logger.info(`[${requestId}] Uploaded ${safeFileName} to ${sanitizedRemotePath}`)
          } catch (error) {
            logger.error(`[${requestId}] Failed to upload file ${file.name}:`, error)
            throw new Error(
              `Failed to upload file "${file.name}": ${error instanceof Error ? error.message : 'Unknown error'}`
            )
          }
        }
      }

      if (hasDirectContent) {
        const safeFileName = sanitizeFileName(params.fileName!)
        const fullRemotePath = remotePath.endsWith('/')
          ? `${remotePath}${safeFileName}`
          : `${remotePath}/${safeFileName}`

        const sanitizedRemotePath = sanitizePath(fullRemotePath)

        if (!params.overwrite) {
          const exists = await sftpExists(sftp, sanitizedRemotePath)
          if (exists) {
            return NextResponse.json(
              { error: 'File already exists and overwrite is disabled' },
              { status: 409 }
            )
          }
        }

        let content: Buffer
        try {
          content = Buffer.from(params.fileContent!, 'base64')
          const reEncoded = content.toString('base64')
          if (reEncoded !== params.fileContent) {
            content = Buffer.from(params.fileContent!, 'utf-8')
          }
        } catch {
          content = Buffer.from(params.fileContent!, 'utf-8')
        }

        await new Promise<void>((resolve, reject) => {
          const writeStream = sftp.createWriteStream(sanitizedRemotePath, {
            mode: params.permissions ? Number.parseInt(params.permissions, 8) : 0o644,
          })

          writeStream.on('error', reject)
          writeStream.on('close', () => resolve())
          writeStream.end(content)
        })

        uploadedFiles.push({
          name: safeFileName,
          remotePath: sanitizedRemotePath,
          size: content.length,
        })

        logger.info(`[${requestId}] Uploaded direct content to ${sanitizedRemotePath}`)
      }

      logger.info(`[${requestId}] SFTP upload completed: ${uploadedFiles.length} file(s)`)

      return NextResponse.json({
        success: true,
        uploadedFiles,
        message: `Successfully uploaded ${uploadedFiles.length} file(s)`,
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
    logger.error(`[${requestId}] SFTP upload failed:`, error)

    return NextResponse.json({ error: `SFTP upload failed: ${errorMessage}` }, { status: 500 })
  }
}
