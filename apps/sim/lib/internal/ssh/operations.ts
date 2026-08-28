import path from 'node:path'
import { generateId } from '@sim/utils/id'
import type { Client, FileEntry, SFTPWrapper, Stats } from 'ssh2'
import type { ContractBody } from '@/lib/api/contracts'
import type {
  sshCheckCommandExistsContract,
  sshCheckFileExistsContract,
  sshCreateDirectoryContract,
  sshDeleteFileContract,
  sshDownloadFileContract,
  sshExecuteCommandContract,
  sshExecuteScriptContract,
  sshGetSystemInfoContract,
  sshListDirectoryContract,
  sshMoveRenameContract,
  sshReadFileContentContract,
  sshUploadFileContract,
  sshWriteFileContentContract,
} from '@/lib/api/contracts/storage-transfer'
import {
  assertKnownSizeWithinLimit,
  isPayloadSizeLimitError,
  readNodeStreamToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import {
  createSSHConnection,
  escapeShellArg,
  executeSSHCommand,
  getFileType,
  parsePermissions,
  type SSHConnectionConfig,
  sanitizeCommand,
  sanitizePath,
} from '@/lib/internal/ssh/client'
import { SshOperationError } from '@/lib/internal/ssh/errors'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'

export interface SshOperationContext {
  signal?: AbortSignal
}

type CheckCommandExistsInput = ContractBody<typeof sshCheckCommandExistsContract>
type CheckFileExistsInput = ContractBody<typeof sshCheckFileExistsContract>
type CreateDirectoryInput = ContractBody<typeof sshCreateDirectoryContract>
type DeleteFileInput = ContractBody<typeof sshDeleteFileContract>
type DownloadFileInput = ContractBody<typeof sshDownloadFileContract>
type ExecuteCommandInput = ContractBody<typeof sshExecuteCommandContract>
type ExecuteScriptInput = ContractBody<typeof sshExecuteScriptContract>
type GetSystemInfoInput = ContractBody<typeof sshGetSystemInfoContract>
type ListDirectoryInput = ContractBody<typeof sshListDirectoryContract>
type MoveRenameInput = ContractBody<typeof sshMoveRenameContract>
type ReadFileContentInput = ContractBody<typeof sshReadFileContentContract>
type UploadFileInput = ContractBody<typeof sshUploadFileContract>
type WriteFileContentInput = ContractBody<typeof sshWriteFileContentContract>

export const MAX_SSH_FILE_BYTES = 50 * 1024 * 1024
const MAX_SSH_UPLOAD_INPUT_BYTES = Math.ceil((MAX_SSH_FILE_BYTES * 4) / 3) + 4

async function withClient<T>(
  input: SSHConnectionConfig,
  context: SshOperationContext,
  operation: (client: Client) => Promise<T>
): Promise<T> {
  const client = await createSSHConnection(input, context.signal)
  const abort = () => client.destroy()
  context.signal?.addEventListener('abort', abort, { once: true })
  try {
    context.signal?.throwIfAborted()
    const result = await operation(client)
    context.signal?.throwIfAborted()
    return result
  } catch (error) {
    context.signal?.throwIfAborted()
    throw error
  } finally {
    context.signal?.removeEventListener('abort', abort)
    client.end()
  }
}

async function getSftp(client: Client, signal?: AbortSignal): Promise<SFTPWrapper> {
  signal?.throwIfAborted()
  const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
    client.sftp((error, channel) => (error ? reject(error) : resolve(channel)))
  })
  signal?.throwIfAborted()
  return sftp
}

function stat(sftp: SFTPWrapper, filePath: string, signal?: AbortSignal): Promise<Stats> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    sftp.stat(filePath, (error, stats) => {
      if (signal?.aborted) reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      else if (error) reject(error)
      else resolve(stats)
    })
  })
}

async function pathExists(
  sftp: SFTPWrapper,
  filePath: string,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    await stat(sftp, filePath, signal)
    return true
  } catch {
    signal?.throwIfAborted()
    return false
  }
}

async function readFile(
  sftp: SFTPWrapper,
  filePath: string,
  maxBytes: number,
  label: string,
  signal?: AbortSignal
): Promise<Buffer> {
  const stream = sftp.createReadStream(filePath)
  stream.on('error', () => {})
  return readNodeStreamToBufferWithLimit(stream, { maxBytes, label, signal })
}

async function writeFile(
  sftp: SFTPWrapper,
  filePath: string,
  content: Buffer,
  mode: number,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const stream = sftp.createWriteStream(filePath, { mode })
    const abort = () => stream.destroy()
    const cleanup = () => signal?.removeEventListener('abort', abort)
    signal?.addEventListener('abort', abort, { once: true })
    stream.on('error', (error: Error) => {
      cleanup()
      reject(signal?.aborted ? signal.reason : error)
    })
    stream.on('close', () => {
      cleanup()
      if (signal?.aborted) reject(signal.reason)
      else resolve()
    })
    stream.end(content)
  })
  signal?.throwIfAborted()
}

export async function executeSshCheckCommandExists(
  input: CheckCommandExistsInput,
  context: SshOperationContext
): Promise<unknown> {
  return withClient(input, context, async (client) => {
    const escapedCommand = escapeShellArg(input.commandName)
    const result = await executeSSHCommand(
      client,
      `command -v '${escapedCommand}' 2>/dev/null || which '${escapedCommand}' 2>/dev/null`,
      context.signal
    )
    const exists = result.exitCode === 0 && result.stdout.trim().length > 0
    const commandPath = exists ? result.stdout.trim() : undefined
    let version: string | undefined
    if (exists) {
      try {
        const versionResult = await executeSSHCommand(
          client,
          `'${escapedCommand}' --version 2>&1 | head -1 || '${escapedCommand}' -v 2>&1 | head -1`,
          context.signal
        )
        if (versionResult.exitCode === 0 && versionResult.stdout.trim()) {
          version = versionResult.stdout.trim()
        }
      } catch {
        context.signal?.throwIfAborted()
      }
    }
    return {
      exists,
      path: commandPath,
      version,
      message: exists
        ? `Command '${input.commandName}' found at ${commandPath}`
        : `Command '${input.commandName}' not found`,
    }
  })
}

export async function executeSshCheckFileExists(
  input: CheckFileExistsInput,
  context: SshOperationContext
): Promise<unknown> {
  return withClient(input, context, async (client) => {
    const sftp = await getSftp(client, context.signal)
    const filePath = sanitizePath(input.path)
    let stats: Stats
    try {
      stats = await stat(sftp, filePath, context.signal)
    } catch {
      context.signal?.throwIfAborted()
      return { exists: false, type: 'not_found', message: `Path does not exist: ${filePath}` }
    }
    const fileType = getFileType(stats)
    const metadata = {
      type: fileType,
      size: stats.size,
      permissions: parsePermissions(stats.mode),
      modified: new Date((stats.mtime || 0) * 1000).toISOString(),
    }
    if (input.type !== 'any' && fileType !== input.type) {
      return {
        exists: false,
        ...metadata,
        message: `Path exists but is a ${fileType}, not a ${input.type}`,
      }
    }
    return { exists: true, ...metadata, message: `Path exists: ${filePath} (${fileType})` }
  })
}

export async function executeSshCreateDirectory(
  input: CreateDirectoryInput,
  context: SshOperationContext
): Promise<unknown> {
  return withClient(input, context, async (client) => {
    const dirPath = sanitizePath(input.path)
    const escapedPath = escapeShellArg(dirPath)
    const check = await executeSSHCommand(
      client,
      `test -d '${escapedPath}' && echo "exists"`,
      context.signal
    )
    if (check.stdout.trim() === 'exists') {
      return {
        created: false,
        path: dirPath,
        alreadyExists: true,
        message: `Directory already exists: ${dirPath}`,
      }
    }
    const result = await executeSSHCommand(
      client,
      `mkdir ${input.recursive ? '-p' : ''} -m ${input.permissions} '${escapedPath}'`,
      context.signal
    )
    if (result.exitCode !== 0) throw new Error(result.stderr || 'Failed to create directory')
    return {
      created: true,
      path: dirPath,
      alreadyExists: false,
      message: `Directory created successfully: ${dirPath}`,
    }
  })
}

export async function executeSshDeleteFile(
  input: DeleteFileInput,
  context: SshOperationContext
): Promise<unknown> {
  return withClient(input, context, async (client) => {
    const filePath = sanitizePath(input.path)
    const escapedPath = escapeShellArg(filePath)
    const check = await executeSSHCommand(
      client,
      `test -e '${escapedPath}' && echo "exists"`,
      context.signal
    )
    if (check.stdout.trim() !== 'exists') {
      throw new SshOperationError(404, { error: `Path does not exist: ${filePath}` })
    }
    const flag = input.recursive ? (input.force ? '-rf' : '-r') : input.force ? '-f' : ''
    const result = await executeSSHCommand(client, `rm ${flag} '${escapedPath}'`, context.signal)
    if (result.exitCode !== 0) throw new Error(result.stderr || 'Failed to delete path')
    return { deleted: true, path: filePath, message: `Successfully deleted: ${filePath}` }
  })
}

export async function executeSshDownloadFile(
  input: DownloadFileInput,
  context: SshOperationContext
): Promise<unknown> {
  return withClient(input, context, async (client) => {
    const sftp = await getSftp(client, context.signal)
    const remotePath = sanitizePath(input.remotePath)
    let stats: Stats
    try {
      stats = await stat(sftp, remotePath, context.signal)
    } catch {
      context.signal?.throwIfAborted()
      throw new Error(`File not found: ${remotePath}`)
    }
    if (stats.size > MAX_SSH_FILE_BYTES) {
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2)
      throw new SshOperationError(413, {
        error: `File size (${sizeMB}MB) exceeds download limit of 50MB`,
      })
    }
    const content = await readFile(
      sftp,
      remotePath,
      MAX_SSH_FILE_BYTES,
      'SSH file download',
      context.signal
    )
    const fileName = path.basename(remotePath)
    const base64Content = content.toString('base64')
    return {
      downloaded: true,
      file: {
        name: fileName,
        mimeType: getMimeTypeFromExtension(getFileExtension(fileName)),
        data: base64Content,
        size: content.length,
      },
      content: base64Content,
      fileName,
      remotePath,
      size: content.length,
      message: `File downloaded successfully from ${remotePath}`,
    }
  })
}

export async function executeSshExecuteCommand(
  input: ExecuteCommandInput,
  context: SshOperationContext
): Promise<unknown> {
  return withClient(input, context, async (client) => {
    let command = sanitizeCommand(input.command)
    if (input.workingDirectory) {
      command = `cd '${escapeShellArg(input.workingDirectory)}' && ${command}`
    }
    const result = await executeSSHCommand(client, command, context.signal)
    return {
      ...result,
      success: result.exitCode === 0,
      message: `Command executed with exit code ${result.exitCode}`,
    }
  })
}

export async function executeSshExecuteScript(
  input: ExecuteScriptInput,
  context: SshOperationContext
): Promise<unknown> {
  return withClient(input, context, async (client) => {
    const scriptPath = `/tmp/sim_script_${generateId().slice(0, 8)}.sh`
    const escapedScriptPath = escapeShellArg(scriptPath)
    const heredocDelimiter = `SIMEOF_${generateId().replace(/-/g, '')}`
    let command = `cat > '${escapedScriptPath}' << '${heredocDelimiter}'
${input.script}
${heredocDelimiter}
chmod +x '${escapedScriptPath}'`
    if (input.workingDirectory) command += `\ncd '${escapeShellArg(input.workingDirectory)}'`
    command += `\ntrap "rm -f ${scriptPath}" EXIT
'${escapeShellArg(input.interpreter)}' '${escapedScriptPath}'
exit_code=$?
exit $exit_code`
    const result = await executeSSHCommand(client, command, context.signal)
    return {
      ...result,
      success: result.exitCode === 0,
      scriptPath,
      message: `Script executed with exit code ${result.exitCode}`,
    }
  })
}

export async function executeSshGetSystemInfo(
  input: GetSystemInfoInput,
  context: SshOperationContext
): Promise<unknown> {
  return withClient(input, context, async (client) => {
    const run = (command: string) => executeSSHCommand(client, command, context.signal)
    const hostname = (await run('hostname')).stdout.trim()
    const os = (await run('uname -s')).stdout.trim()
    const architecture = (await run('uname -m')).stdout.trim()
    const uptime =
      Number.parseInt(
        (
          await run(
            "cat /proc/uptime 2>/dev/null | awk '{print int($1)}' || sysctl -n kern.boottime 2>/dev/null | awk '{print int(($(date +%s)) - $4)}'"
          )
        ).stdout.trim()
      ) || 0
    const memoryParts = (
      await run(
        "free -b 2>/dev/null | awk '/Mem:/ {print $2, $7, $3}' || vm_stat 2>/dev/null | awk '/Pages free|Pages active|Pages speculative|Pages wired|page size/ {gsub(/[^0-9]/, \"\"); print}'"
      )
    ).stdout
      .trim()
      .split(/\s+/)
    const diskParts = (
      await run(
        "df -B1 / 2>/dev/null | awk 'NR==2 {print $2, $4, $3}' || df -k / 2>/dev/null | awk 'NR==2 {print $2*1024, $4*1024, $3*1024}'"
      )
    ).stdout
      .trim()
      .split(/\s+/)
    const parseMetrics = (parts: string[]) =>
      parts.length >= 3
        ? {
            total: Number.parseInt(parts[0]) || 0,
            free: Number.parseInt(parts[1]) || 0,
            used: Number.parseInt(parts[2]) || 0,
          }
        : { total: 0, free: 0, used: 0 }
    return {
      hostname,
      os,
      architecture,
      uptime,
      memory: parseMetrics(memoryParts),
      diskSpace: parseMetrics(diskParts),
      message: `System info retrieved for ${hostname}`,
    }
  })
}

export async function executeSshListDirectory(
  input: ListDirectoryInput,
  context: SshOperationContext
): Promise<unknown> {
  return withClient(input, context, async (client) => {
    const sftp = await getSftp(client, context.signal)
    const dirPath = sanitizePath(input.path)
    const list = await new Promise<FileEntry[]>((resolve, reject) => {
      sftp.readdir(dirPath, (error, entries) => (error ? reject(error) : resolve(entries)))
    })
    context.signal?.throwIfAborted()
    const entries = list.map((entry) => ({
      name: entry.filename,
      type: getFileType(entry.attrs),
      size: entry.attrs.size,
      permissions: parsePermissions(entry.attrs.mode),
      modified: new Date((entry.attrs.mtime || 0) * 1000).toISOString(),
    }))
    const totalFiles = entries.filter((entry) => entry.type === 'file').length
    const totalDirectories = entries.filter((entry) => entry.type === 'directory').length
    return {
      entries,
      totalFiles,
      totalDirectories,
      message: `Found ${totalFiles} files and ${totalDirectories} directories`,
    }
  })
}

export async function executeSshMoveRename(
  input: MoveRenameInput,
  context: SshOperationContext
): Promise<unknown> {
  return withClient(input, context, async (client) => {
    const sourcePath = sanitizePath(input.sourcePath)
    const destinationPath = sanitizePath(input.destinationPath)
    const escapedSource = escapeShellArg(sourcePath)
    const escapedDestination = escapeShellArg(destinationPath)
    const source = await executeSSHCommand(
      client,
      `test -e '${escapedSource}' && echo "exists"`,
      context.signal
    )
    if (source.stdout.trim() !== 'exists') {
      throw new SshOperationError(404, { error: `Source path does not exist: ${sourcePath}` })
    }
    if (!input.overwrite) {
      const destination = await executeSSHCommand(
        client,
        `test -e '${escapedDestination}' && echo "exists"`,
        context.signal
      )
      if (destination.stdout.trim() === 'exists') {
        throw new SshOperationError(409, {
          error: `Destination already exists and overwrite is disabled: ${destinationPath}`,
        })
      }
    }
    const result = await executeSSHCommand(
      client,
      `mv${input.overwrite ? ' -f' : ''} '${escapedSource}' '${escapedDestination}'`,
      context.signal
    )
    if (result.exitCode !== 0) throw new Error(result.stderr || 'Failed to move/rename')
    return {
      success: true,
      sourcePath,
      destinationPath,
      message: `Successfully moved ${sourcePath} to ${destinationPath}`,
    }
  })
}

export async function executeSshReadFileContent(
  input: ReadFileContentInput,
  context: SshOperationContext
): Promise<unknown> {
  return withClient(input, context, async (client) => {
    const sftp = await getSftp(client, context.signal)
    const filePath = sanitizePath(input.path)
    const maxBytes = input.maxSize * 1024 * 1024
    let stats: Stats
    try {
      stats = await stat(sftp, filePath, context.signal)
    } catch {
      context.signal?.throwIfAborted()
      throw new Error(`File not found: ${filePath}`)
    }
    if (stats.size > maxBytes) {
      throw new SshOperationError(413, {
        error: `File size (${stats.size} bytes) exceeds maximum allowed (${maxBytes} bytes)`,
      })
    }
    const buffer = await readFile(sftp, filePath, maxBytes, `File '${filePath}'`, context.signal)
    const content = buffer.toString(input.encoding as BufferEncoding)
    const lines = content.split('\n').length
    return {
      content,
      size: buffer.length,
      lines,
      path: filePath,
      message: `File read successfully: ${buffer.length} bytes, ${lines} lines`,
    }
  })
}

function decodeUploadContent(fileContent: string): Buffer {
  try {
    const content = Buffer.from(fileContent, 'base64')
    return content.toString('base64') === fileContent ? content : Buffer.from(fileContent, 'utf-8')
  } catch {
    return Buffer.from(fileContent, 'utf-8')
  }
}

export async function executeSshUploadFile(
  input: UploadFileInput,
  context: SshOperationContext
): Promise<unknown> {
  return withClient(input, context, async (client) => {
    const sftp = await getSftp(client, context.signal)
    const remotePath = sanitizePath(input.remotePath)
    if (!input.overwrite && (await pathExists(sftp, remotePath, context.signal))) {
      throw new SshOperationError(409, { error: 'File already exists and overwrite is disabled' })
    }
    assertKnownSizeWithinLimit(
      Buffer.byteLength(input.fileContent, 'utf8'),
      MAX_SSH_UPLOAD_INPUT_BYTES,
      'SSH upload input'
    )
    const content = decodeUploadContent(input.fileContent)
    assertKnownSizeWithinLimit(content.length, MAX_SSH_FILE_BYTES, 'SSH upload file')
    await writeFile(
      sftp,
      remotePath,
      content,
      input.permissions ? Number.parseInt(input.permissions, 8) : 0o644,
      context.signal
    )
    return {
      uploaded: true,
      remotePath,
      size: content.length,
      message: `File uploaded successfully to ${remotePath}`,
    }
  })
}

export async function executeSshWriteFileContent(
  input: WriteFileContentInput,
  context: SshOperationContext
): Promise<unknown> {
  return withClient(input, context, async (client) => {
    const sftp = await getSftp(client, context.signal)
    const filePath = sanitizePath(input.path)
    if (input.mode === 'create' && (await pathExists(sftp, filePath, context.signal))) {
      throw new SshOperationError(409, {
        error: `File already exists and mode is 'create': ${filePath}`,
      })
    }
    const inputBytes = Buffer.byteLength(input.content, 'utf8')
    assertKnownSizeWithinLimit(inputBytes, MAX_SSH_FILE_BYTES, `File '${filePath}'`)
    let content = Buffer.from(input.content, 'utf-8')
    if (input.mode === 'append') {
      try {
        const existing = await readFile(
          sftp,
          filePath,
          MAX_SSH_FILE_BYTES,
          `Existing file '${filePath}'`,
          context.signal
        )
        assertKnownSizeWithinLimit(
          existing.length + inputBytes,
          MAX_SSH_FILE_BYTES,
          `File '${filePath}'`
        )
        content = Buffer.concat([existing, content], existing.length + inputBytes)
      } catch (error) {
        context.signal?.throwIfAborted()
        if (isPayloadSizeLimitError(error)) throw error
      }
    }
    assertKnownSizeWithinLimit(content.length, MAX_SSH_FILE_BYTES, `File '${filePath}'`)
    await writeFile(
      sftp,
      filePath,
      content,
      input.permissions ? Number.parseInt(input.permissions, 8) : 0o644,
      context.signal
    )
    const stats = await stat(sftp, filePath, context.signal)
    return {
      written: true,
      path: filePath,
      size: stats.size,
      message: `File written successfully: ${stats.size} bytes`,
    }
  })
}
