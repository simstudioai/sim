import path from 'path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import type { Client, SFTPWrapper } from 'ssh2'
import { sshDownloadFileContract } from '@/lib/api/contracts/storage-transfer'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import { createSSHConnection, sanitizePath } from '@/app/api/tools/ssh/utils'

const logger = createLogger('SSHDownloadFileAPI')

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

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized SSH download file attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(sshDownloadFileContract, request, {})
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(
      `[${requestId}] Downloading file from ${params.host}:${params.port}${params.remotePath}`
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
      const remotePath = sanitizePath(params.remotePath)

      // Check if file exists
      const stats = await new Promise<{ size: number }>((resolve, reject) => {
        sftp.stat(remotePath, (err, stats) => {
          if (err) {
            reject(new Error(`File not found: ${remotePath}`))
          } else {
            resolve(stats)
          }
        })
      })

      // Check file size limit (50MB to prevent memory exhaustion)
      const maxSize = 50 * 1024 * 1024
      if (stats.size > maxSize) {
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2)
        return NextResponse.json(
          { error: `File size (${sizeMB}MB) exceeds download limit of 50MB` },
          { status: 400 }
        )
      }

      // Read file content
      const content = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = []
        const readStream = sftp.createReadStream(remotePath)

        readStream.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })

        readStream.on('end', () => {
          resolve(Buffer.concat(chunks))
        })

        readStream.on('error', reject)
      })

      const fileName = path.basename(remotePath)
      const extension = getFileExtension(fileName)
      const mimeType = getMimeTypeFromExtension(extension)

      // Encode content as base64 for binary safety
      const base64Content = content.toString('base64')

      logger.info(`[${requestId}] File downloaded successfully from ${remotePath}`)

      return NextResponse.json({
        downloaded: true,
        file: {
          name: fileName,
          mimeType,
          data: base64Content,
          size: stats.size,
        },
        content: base64Content,
        fileName: fileName,
        remotePath: remotePath,
        size: stats.size,
        message: `File downloaded successfully from ${remotePath}`,
      })
    } finally {
      client.end()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] SSH file download failed:`, error)

    return NextResponse.json(
      { error: `SSH file download failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
