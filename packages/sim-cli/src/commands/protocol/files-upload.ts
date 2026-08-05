import type { Command } from 'commander'
import { clientFrom } from '../../context.js'
import type {
  CompleteFileUploadResponse,
  CreateFileUploadResponse,
} from '../../generated/v2-api.js'
import { contentTypeFor, localFile } from '../../transfer/local-file.js'
import { finishUploadSession } from '../../transfer/upload-session.js'
import { printProtocolResult } from './result.js'

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

        const created = await client.request<CreateFileUploadResponse>('/api/v2/files/uploads', {
          method: 'POST',
          body: {
            workspaceId,
            name,
            contentType: contentTypeFor(name),
            size,
            ...(options.folderId ? { folderId: options.folderId } : {}),
          },
        })
        const { session, uploadToken, transfer } = created.data
        const completed = await finishUploadSession<CompleteFileUploadResponse['data']>(
          client,
          workspaceId,
          {
            basePath: `/api/v2/files/uploads/${encodeURIComponent(session.id)}`,
            uploadToken,
            transfer,
            size,
          },
          path
        )

        printProtocolResult(profile.output, {
          id: completed.file?.id ?? session.id,
          name,
          size,
          status: 'uploaded',
        })
      }
    )
}
