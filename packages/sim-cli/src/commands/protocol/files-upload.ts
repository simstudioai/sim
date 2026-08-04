import type { Command } from 'commander'
import { clientFrom } from '../../context.js'
import { contentTypeFor, localFile } from '../../transfer/local-file.js'
import { finishTransfer } from '../../transfer/multipart.js'
import { printProtocolResult } from './result.js'

interface FileUpload {
  id: string
  uploadToken: string
  partSize: number
  partCount: number
  file: { id: string } | null
}

export function attachFileUpload(files: Command): void {
  files
    .command('upload <path>')
    .description('Upload a file to the workspace')
    .option('--folder-id <id>', 'Target folder (defaults to the workspace root)')
    .option('--name <name>', 'Store it under a different name')
    .action(
      async (path: string, options: { folderId?: string; name?: string }, command: Command) => {
        const { client, profile } = clientFrom(command)
        const workspaceId = client.requireWorkspace()
        const { name, size } = await localFile(path, options.name)

        const created = await client.request<{ data: FileUpload }>('/api/v2/files/uploads', {
          method: 'POST',
          body: {
            workspaceId,
            name,
            contentType: contentTypeFor(name),
            size,
            ...(options.folderId ? { folderId: options.folderId } : {}),
          },
        })
        const upload = created.data
        const completed = await finishTransfer<FileUpload>(
          client,
          workspaceId,
          {
            basePath: `/api/v2/files/uploads/${encodeURIComponent(upload.id)}`,
            uploadToken: upload.uploadToken,
            partSize: upload.partSize,
            partCount: upload.partCount,
            size,
          },
          path
        )

        printProtocolResult(profile.output, {
          id: completed.file?.id ?? completed.id,
          name,
          size,
          status: 'uploaded',
        })
      }
    )
}
