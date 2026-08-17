import type { Command } from 'commander'
import { clientFrom } from '../../context'
import type {
  CompleteKnowledgeDocumentUploadResponse,
  CreateKnowledgeDocumentUploadResponse,
} from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { contentTypeFor, localFile } from '../../transfer/local-file'
import { finishUploadSession } from '../../transfer/upload-session'
import { printProtocolResult } from './result'

interface KnowledgeDocumentUploadOptions {
  name?: string
  tag?: string[]
  recipe?: string
  lang?: string
}

function uploadMetadata(options: KnowledgeDocumentUploadOptions): Record<string, unknown> {
  if (options.tag && options.tag.length > 7) {
    throw new SimApiError('--tag accepts at most seven values', 0)
  }

  const metadata: Record<string, unknown> = {}
  options.tag?.forEach((value, index) => {
    metadata[`tag${index + 1}`] = value
  })

  if (options.recipe || options.lang) {
    metadata.processingOptions = {
      ...(options.recipe ? { recipe: options.recipe } : {}),
      ...(options.lang ? { lang: options.lang } : {}),
    }
  }
  return metadata
}

export function attachKnowledgeDocumentUpload(documents: Command): void {
  documents
    .command('upload')
    .argument('<knowledgeBaseId>', 'Knowledge base to upload into')
    .argument('<path>', 'Local file to upload')
    .description('Upload a document to a knowledge base')
    .option('--name <name>', 'Store it under a different name')
    .option('--tag <value...>', 'Document tags, in tag1 through tag7 order')
    .option('--recipe <name>', 'Document processing recipe')
    .option('--lang <code>', 'Document language code')
    .action(
      async (
        knowledgeBaseId: string,
        path: string,
        options: KnowledgeDocumentUploadOptions,
        command: Command
      ) => {
        const { client, profile } = clientFrom(command)
        const workspaceId = client.requireWorkspace()
        const { name, size } = await localFile(path, options.name)
        const created = await client.request<CreateKnowledgeDocumentUploadResponse>(
          `/api/v2/knowledge/${encodeURIComponent(knowledgeBaseId)}/documents/uploads`,
          {
            method: 'POST',
            body: {
              workspaceId,
              name,
              contentType: contentTypeFor(name),
              size,
              ...uploadMetadata(options),
            },
          }
        )
        const { session, uploadToken, transfer } = created.data
        const completed = await finishUploadSession<
          CompleteKnowledgeDocumentUploadResponse['data']
        >(
          client,
          workspaceId,
          {
            basePath: `/api/v2/knowledge/${encodeURIComponent(
              knowledgeBaseId
            )}/documents/uploads/${encodeURIComponent(session.id)}`,
            uploadToken,
            transfer,
            size,
          },
          path
        )

        if (!completed.document) {
          throw new Error(`Knowledge upload ${session.id} completed without a document`)
        }
        printProtocolResult(profile.output, {
          id: completed.document.id,
          knowledgeBaseId: completed.document.knowledgeBaseId,
          name: completed.document.filename,
          size: completed.document.fileSize,
          status: completed.document.processingStatus,
        })
      }
    )
}
