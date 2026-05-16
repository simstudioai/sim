import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { type NextRequest, NextResponse } from 'next/server'
import type { Client, FileEntry, SFTPWrapper } from 'ssh2'
import { sshListDirectoryContract } from '@/lib/api/contracts/storage-transfer'
import { parseRequest } from '@/lib/api/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  createSSHConnection,
  getFileType,
  parsePermissions,
  sanitizePath,
} from '@/app/api/tools/ssh/utils'

const logger = createLogger('SSHListDirectoryAPI')

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

interface FileInfo {
  name: string
  type: 'file' | 'directory' | 'symlink' | 'other'
  size: number
  permissions: string
  modified: string
}

async function listDir(sftp: SFTPWrapper, dirPath: string): Promise<FileEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(dirPath, (err, list) => {
      if (err) {
        reject(err)
      } else {
        resolve(list)
      }
    })
  })
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateId().slice(0, 8)

  try {
    const auth = await checkInternalAuth(request)
    if (!auth.success || !auth.userId) {
      logger.warn(`[${requestId}] Unauthorized SSH list directory attempt`)
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(sshListDirectoryContract, request, {})
    if (!parsed.success) return parsed.response
    const params = parsed.data.body

    logger.info(`[${requestId}] Listing directory ${params.path} on ${params.host}:${params.port}`)

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
      const dirPath = sanitizePath(params.path)

      const list = await listDir(sftp, dirPath)

      const entries: FileInfo[] = list.map((entry) => ({
        name: entry.filename,
        type: getFileType(entry.attrs),
        size: entry.attrs.size,
        permissions: parsePermissions(entry.attrs.mode),
        modified: new Date((entry.attrs.mtime || 0) * 1000).toISOString(),
      }))

      const totalFiles = entries.filter((e) => e.type === 'file').length
      const totalDirectories = entries.filter((e) => e.type === 'directory').length

      logger.info(
        `[${requestId}] Directory listed successfully: ${totalFiles} files, ${totalDirectories} directories`
      )

      return NextResponse.json({
        entries,
        totalFiles,
        totalDirectories,
        message: `Found ${totalFiles} files and ${totalDirectories} directories`,
      })
    } finally {
      client.end()
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error occurred')
    logger.error(`[${requestId}] SSH list directory failed:`, error)

    return NextResponse.json(
      { error: `SSH list directory failed: ${errorMessage}` },
      { status: 500 }
    )
  }
})
