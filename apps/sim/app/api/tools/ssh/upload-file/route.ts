import { randomUUID } from 'crypto'
import { type NextRequest, NextResponse } from 'next/server'
import type { Client, SFTPWrapper } from 'ssh2'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'
import { createSSHConnection, sanitizePath } from '@/app/api/tools/ssh/utils'

const logger = createLogger('SSHUploadFileAPI')

const UploadFileSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.coerce.number().int().positive().default(22),
  username: z.string().min(1, 'Username is required'),
  password: z.string().nullish(),
  privateKey: z.string().nullish(),
  passphrase: z.string().nullish(),
  fileContent: z.string().min(1, 'File content is required'),
  fileName: z.string().min(1, 'File name is required'),
  remotePath: z.string().min(1, 'Remote path is required'),
  permissions: z.string().nullish(),
  overwrite: z.boolean().default(true),
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
    const body = await request.json()
    const params = UploadFileSchema.parse(body)

    // Validate authentication
    if (!params.password && !params.privateKey) {
      return NextResponse.json(
        { error: 'Either password or privateKey must be provided' },
        { status: 400 }
      )
    }

    logger.info(
      `[${requestId}] Uploading file to ${params.host}:${params.port}${params.remotePath}`
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

      // Check if file exists and overwrite is false
      if (!params.overwrite) {
        const exists = await new Promise<boolean>((resolve) => {
          sftp.stat(remotePath, (err) => {
            resolve(!err)
          })
        })

        if (exists) {
          return NextResponse.json(
            { error: 'File already exists and overwrite is disabled' },
            { status: 409 }
          )
        }
      }

      // Decode content (handle base64 for binary files)
      let content: Buffer
      try {
        // Try to decode as base64 first
        content = Buffer.from(params.fileContent, 'base64')
        // If the decoded content is not valid UTF-8 or looks like base64, use it as-is
        const reEncoded = content.toString('base64')
        if (reEncoded !== params.fileContent) {
          // Not valid base64, treat as plain text
          content = Buffer.from(params.fileContent, 'utf-8')
        }
      } catch {
        // Plain text content
        content = Buffer.from(params.fileContent, 'utf-8')
      }

      // Write file
      await new Promise<void>((resolve, reject) => {
        const writeStream = sftp.createWriteStream(remotePath, {
          mode: params.permissions ? Number.parseInt(params.permissions, 8) : 0o644,
        })

        writeStream.on('error', reject)
        writeStream.on('close', () => resolve())

        writeStream.end(content)
      })

      logger.info(`[${requestId}] File uploaded successfully to ${remotePath}`)

      return NextResponse.json({
        uploaded: true,
        remotePath: remotePath,
        size: content.length,
        message: `File uploaded successfully to ${remotePath}`,
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
    logger.error(`[${requestId}] SSH file upload failed:`, error)

    return NextResponse.json({ error: `SSH file upload failed: ${errorMessage}` }, { status: 500 })
  }
}
