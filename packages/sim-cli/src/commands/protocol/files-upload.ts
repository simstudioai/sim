import type { Command } from 'commander'
import { clientFrom } from '../../context'
import type { CompleteFileUploadResponse, CreateFileUploadResponse } from '../../generated/v2-api'
import { V2_OPERATIONS } from '../../generated/v2-api'
import { encodeFolderPath } from '../../runtime/request'
import { contentTypeFor, localFile } from '../../transfer/local-file'
import { finishUploadSession } from '../../transfer/upload-session'
import { printProtocolResult } from './result'

export function attachFileUpload(files: Command): void {
  files
    .command('upload')
    .argument('<path>', 'Local file to upload')
    .description('Upload a file to the workspace')
    .option('--folder <path>', 'Folder path as shown in the app; defaults to the root folder')
    .option('--name <name>', 'Store it under a different name')
    .action(async (path: string, options: { folder?: string; name?: string }, command: Command) => {
      const { client, profile } = clientFrom(command)
      const workspaceId = client.requireWorkspace()
      const { name, size } = await localFile(path, options.name)

      const created = await client.request<CreateFileUploadResponse>(
        V2_OPERATIONS.createFileUpload.path,
        {
          method: 'POST',
          body: {
            workspaceId,
            name,
            contentType: contentTypeFor(name),
            size,
            // `<path>` above is a LOCAL file and must stay untouched; only the
            // destination folder is a wire-encoded API path.
            ...(options.folder !== undefined
              ? { folderPath: encodeFolderPath(options.folder) }
              : {}),
          },
        }
      )
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

      if (!completed.file) {
        throw new Error(`File upload ${session.id} completed without a file`)
      }
      printProtocolResult(profile.output, completed.file)
    })
}
