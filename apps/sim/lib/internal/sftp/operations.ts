import path from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import type { FileEntry, SFTPWrapper } from 'ssh2'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import {
  createSftpConnection,
  getFileType,
  getSftp,
  isPathSafe,
  MAX_SFTP_READ_BYTES,
  parsePermissions,
  readSftpFileCapped,
  sanitizeFileName,
  sanitizePath,
  sftpExists,
  sftpIsDirectory,
} from '@/lib/internal/sftp/client'
import type {
  SftpDeleteInput,
  SftpDownloadInput,
  SftpListInput,
  SftpMkdirInput,
  SftpUploadInput,
} from '@/lib/internal/sftp/schema'
import {
  getFileExtension,
  getMimeTypeFromExtension,
  processFilesToUserFiles,
} from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('SftpOperations')
const MAX_SFTP_UPLOAD_BYTES = 100 * 1024 * 1024

export interface SftpOperationContext {
  userId: string
  requestId: string
  signal?: AbortSignal
}

type SftpConnectionInput = Pick<
  SftpDeleteInput,
  'host' | 'port' | 'username' | 'password' | 'privateKey' | 'passphrase'
>

function operationFailure(operation: string, error: unknown): Response {
  return Response.json(
    { error: `SFTP ${operation} failed: ${getErrorMessage(error, 'Unknown error occurred')}` },
    { status: 500 }
  )
}

function unsafePathResponse(): Response {
  return Response.json(
    { error: 'Invalid remote path: path traversal sequences are not allowed' },
    { status: 400 }
  )
}

async function withSftp<T>(
  input: SftpConnectionInput,
  context: SftpOperationContext,
  execute: (sftp: SFTPWrapper) => Promise<T>
): Promise<T> {
  context.signal?.throwIfAborted()
  const client = await createSftpConnection({ ...input, signal: context.signal })
  try {
    const sftp = await getSftp(client, context.signal)
    return await execute(sftp)
  } finally {
    client.end()
  }
}

function sftpCall<T>(
  signal: AbortSignal | undefined,
  start: (callback: (error: Error | undefined, value?: T) => void) => void
): Promise<T> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () => {
      finish(() => reject(toError(signal?.reason ?? new Error('Aborted'))))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
    start((error, value) => {
      if (error) finish(() => reject(error))
      else finish(() => resolve(value as T))
    })
  })
}

async function deleteRecursive(
  sftp: SFTPWrapper,
  directoryPath: string,
  signal?: AbortSignal
): Promise<void> {
  const entries = await sftpCall<FileEntry[]>(signal, (callback) =>
    sftp.readdir(directoryPath, (error, list) => callback(error ?? undefined, list))
  )
  for (const entry of entries) {
    signal?.throwIfAborted()
    if (entry.filename === '.' || entry.filename === '..') continue
    const entryPath = `${directoryPath}/${entry.filename}`
    if (getFileType(entry.attrs) === 'directory') {
      await deleteRecursive(sftp, entryPath, signal)
    } else {
      await sftpCall<void>(signal, (callback) =>
        sftp.unlink(entryPath, (error) => callback(error ?? undefined))
      )
    }
  }
  await sftpCall<void>(signal, (callback) =>
    sftp.rmdir(directoryPath, (error) => callback(error ?? undefined))
  )
}

async function mkdirRecursive(
  sftp: SFTPWrapper,
  directoryPath: string,
  signal?: AbortSignal
): Promise<void> {
  const parts = directoryPath.split('/').filter(Boolean)
  let currentPath = ''
  for (const part of parts) {
    signal?.throwIfAborted()
    currentPath = currentPath
      ? `${currentPath}/${part}`
      : directoryPath.startsWith('/')
        ? `/${part}`
        : part
    if (!(await sftpExists(sftp, currentPath, signal))) {
      await sftpCall<void>(signal, (callback) =>
        sftp.mkdir(currentPath, (error) =>
          callback(error && !error.message.includes('already exists') ? error : undefined)
        )
      )
    }
  }
}

function writeSftpFile(
  sftp: SFTPWrapper,
  remotePath: string,
  content: Buffer,
  permissions: string | null | undefined,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const stream = sftp.createWriteStream(remotePath, {
      mode: permissions ? Number.parseInt(permissions, 8) : 0o644,
    })
    let settled = false
    const cleanup = () => {
      stream.off('error', onError)
      stream.off('close', onClose)
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const onError = (error: Error) => finish(() => reject(error))
    const onClose = () => finish(resolve)
    const onAbort = () => {
      const error = toError(signal?.reason ?? new Error('Aborted'))
      stream.destroy()
      finish(() => reject(error))
    }
    stream.on('error', onError)
    stream.on('close', onClose)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
    stream.end(content)
  })
}

export async function executeSftpDelete(
  input: SftpDeleteInput,
  context: SftpOperationContext
): Promise<Response> {
  if (!isPathSafe(input.remotePath)) return unsafePathResponse()
  try {
    return await withSftp(input, context, async (sftp) => {
      const remotePath = sanitizePath(input.remotePath)
      const isDirectory = await sftpIsDirectory(sftp, remotePath, context.signal)
      if (isDirectory) {
        if (input.recursive) {
          await deleteRecursive(sftp, remotePath, context.signal)
        } else {
          await sftpCall<void>(context.signal, (callback) =>
            sftp.rmdir(remotePath, (error) => {
              if (error?.message.includes('not empty')) {
                callback(
                  new Error(
                    'Directory is not empty. Use recursive: true to delete non-empty directories.'
                  )
                )
              } else callback(error ?? undefined)
            })
          )
        }
      } else {
        await sftpCall<void>(context.signal, (callback) =>
          sftp.unlink(remotePath, (error) =>
            callback(
              error?.message.includes('No such file')
                ? new Error(`File not found: ${remotePath}`)
                : (error ?? undefined)
            )
          )
        )
      }
      return Response.json({
        success: true,
        deletedPath: remotePath,
        message: `Successfully deleted ${remotePath}`,
      })
    })
  } catch (error) {
    context.signal?.throwIfAborted()
    return operationFailure('delete', error)
  }
}

export async function executeSftpMkdir(
  input: SftpMkdirInput,
  context: SftpOperationContext
): Promise<Response> {
  if (!isPathSafe(input.remotePath)) return unsafePathResponse()
  try {
    return await withSftp(input, context, async (sftp) => {
      const remotePath = sanitizePath(input.remotePath)
      if (input.recursive) {
        await mkdirRecursive(sftp, remotePath, context.signal)
      } else {
        if (await sftpExists(sftp, remotePath, context.signal)) {
          return Response.json(
            { error: `Directory already exists: ${remotePath}` },
            { status: 409 }
          )
        }
        await sftpCall<void>(context.signal, (callback) =>
          sftp.mkdir(remotePath, (error) =>
            callback(
              error?.message.includes('No such file')
                ? new Error(
                    'Parent directory does not exist. Use recursive: true to create parent directories.'
                  )
                : (error ?? undefined)
            )
          )
        )
      }
      return Response.json({
        success: true,
        createdPath: remotePath,
        message: `Successfully created directory ${remotePath}`,
      })
    })
  } catch (error) {
    context.signal?.throwIfAborted()
    return operationFailure('mkdir', error)
  }
}

export async function executeSftpList(
  input: SftpListInput,
  context: SftpOperationContext
): Promise<Response> {
  if (!isPathSafe(input.remotePath)) return unsafePathResponse()
  try {
    return await withSftp(input, context, async (sftp) => {
      const remotePath = sanitizePath(input.remotePath)
      const files = await sftpCall<FileEntry[]>(context.signal, (callback) =>
        sftp.readdir(remotePath, (error, list) =>
          callback(
            error?.message.includes('No such file')
              ? new Error(`Directory not found: ${remotePath}`)
              : (error ?? undefined),
            list
          )
        )
      )
      const entries = files
        .filter((item) => item.filename !== '.' && item.filename !== '..')
        .map((item) => ({
          name: item.filename,
          type: getFileType(item.attrs),
          ...(input.detailed
            ? {
                size: item.attrs.size,
                permissions: parsePermissions(item.attrs.mode),
                ...(item.attrs.mtime
                  ? { modifiedAt: new Date(item.attrs.mtime * 1000).toISOString() }
                  : {}),
              }
            : {}),
        }))
      entries.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1
        if (a.type !== 'directory' && b.type === 'directory') return 1
        return a.name.localeCompare(b.name)
      })
      return Response.json({
        success: true,
        path: remotePath,
        entries,
        count: entries.length,
        message: `Found ${entries.length} entries in ${remotePath}`,
      })
    })
  } catch (error) {
    context.signal?.throwIfAborted()
    return operationFailure('list', error)
  }
}

export async function executeSftpDownload(
  input: SftpDownloadInput,
  context: SftpOperationContext
): Promise<Response> {
  if (!isPathSafe(input.remotePath)) return unsafePathResponse()
  try {
    return await withSftp(input, context, async (sftp) => {
      const remotePath = sanitizePath(input.remotePath)
      const stats = await sftpCall<{ size: number }>(context.signal, (callback) =>
        sftp.stat(remotePath, (error, attributes) =>
          callback(
            error?.message.includes('No such file')
              ? new Error(`File not found: ${remotePath}`)
              : (error ?? undefined),
            attributes
          )
        )
      )
      if (stats.size > MAX_SFTP_READ_BYTES) {
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2)
        return Response.json(
          { success: false, error: `File size (${sizeMB}MB) exceeds download limit of 50MB` },
          { status: 413 }
        )
      }
      const buffer = await readSftpFileCapped(
        sftp,
        remotePath,
        MAX_SFTP_READ_BYTES,
        'SFTP download',
        context.signal
      )
      const fileName = path.basename(remotePath)
      const extension = getFileExtension(fileName)
      const mimeType = getMimeTypeFromExtension(extension)
      return Response.json({
        success: true,
        fileName,
        file: {
          name: fileName,
          mimeType,
          data: buffer.toString('base64'),
          size: buffer.length,
        },
        content: buffer.toString(input.encoding === 'base64' ? 'base64' : 'utf-8'),
        size: buffer.length,
        encoding: input.encoding,
        message: `Successfully downloaded ${fileName}`,
      })
    })
  } catch (error) {
    context.signal?.throwIfAborted()
    if (isPayloadSizeLimitError(error)) {
      return Response.json(
        { success: false, error: getErrorMessage(error, 'Unknown error occurred') },
        { status: 413 }
      )
    }
    return operationFailure('download', error)
  }
}

export async function executeSftpUpload(
  input: SftpUploadInput,
  context: SftpOperationContext
): Promise<Response> {
  const hasFiles = Boolean(input.files?.length)
  const hasDirectContent = Boolean(input.fileContent && input.fileName)
  if (!hasFiles && !hasDirectContent) {
    return Response.json(
      { error: 'Either files or fileContent with fileName must be provided' },
      { status: 400 }
    )
  }
  if (!isPathSafe(input.remotePath)) return unsafePathResponse()

  try {
    return await withSftp(input, context, async (sftp) => {
      const remotePath = sanitizePath(input.remotePath)
      const uploadedFiles: Array<{ name: string; remotePath: string; size: number }> = []
      if (hasFiles) {
        const userFiles = processFilesToUserFiles(input.files ?? [], context.requestId, logger)
        const totalSize = userFiles.reduce((sum, file) => sum + file.size, 0)
        if (totalSize > MAX_SFTP_UPLOAD_BYTES) {
          return Response.json(
            {
              success: false,
              error: `Total file size (${(totalSize / (1024 * 1024)).toFixed(2)}MB) exceeds limit of 100MB`,
            },
            { status: 400 }
          )
        }

        let resolvedTotal = 0
        for (const file of userFiles) {
          context.signal?.throwIfAborted()
          try {
            const denied = await assertToolFileAccess(
              file.key,
              context.userId,
              context.requestId,
              logger
            )
            if (denied) return denied
            const { buffer } = await downloadServableFileFromStorage(
              file,
              context.requestId,
              logger,
              { maxBytes: MAX_SFTP_UPLOAD_BYTES - resolvedTotal, signal: context.signal }
            )
            resolvedTotal += buffer.length
            const safeName = sanitizeFileName(file.name)
            const destination = sanitizePath(
              remotePath.endsWith('/') ? `${remotePath}${safeName}` : `${remotePath}/${safeName}`
            )
            if (!input.overwrite && (await sftpExists(sftp, destination, context.signal))) continue
            await writeSftpFile(sftp, destination, buffer, input.permissions, context.signal)
            uploadedFiles.push({ name: safeName, remotePath: destination, size: buffer.length })
          } catch (error) {
            context.signal?.throwIfAborted()
            const notReady = docNotReadyResponse(error)
            if (notReady) return notReady
            if (isPayloadSizeLimitError(error)) {
              const observed = resolvedTotal + (error.observedBytes ?? file.size)
              return Response.json(
                {
                  success: false,
                  error: `Total file size (${(observed / (1024 * 1024)).toFixed(2)}MB) exceeds limit of 100MB`,
                },
                { status: 400 }
              )
            }
            throw new Error(
              `Failed to upload file "${file.name}": ${getErrorMessage(error, 'Unknown error')}`
            )
          }
        }
      }

      if (hasDirectContent) {
        const safeName = sanitizeFileName(input.fileName ?? '')
        const destination = sanitizePath(
          remotePath.endsWith('/') ? `${remotePath}${safeName}` : `${remotePath}/${safeName}`
        )
        if (!input.overwrite && (await sftpExists(sftp, destination, context.signal))) {
          return Response.json(
            { error: 'File already exists and overwrite is disabled' },
            { status: 409 }
          )
        }
        const rawContent = input.fileContent ?? ''
        let content = Buffer.from(rawContent, 'base64')
        if (content.toString('base64') !== rawContent) content = Buffer.from(rawContent, 'utf-8')
        await writeSftpFile(sftp, destination, content, input.permissions, context.signal)
        uploadedFiles.push({ name: safeName, remotePath: destination, size: content.length })
      }

      return Response.json({
        success: true,
        uploadedFiles,
        message: `Successfully uploaded ${uploadedFiles.length} file(s)`,
      })
    })
  } catch (error) {
    context.signal?.throwIfAborted()
    return operationFailure('upload', error)
  }
}
