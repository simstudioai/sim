import { type Command, Option } from 'commander'
import { clientFrom } from '../../context'
import type {
  CompleteKnowledgeDocumentUploadResponse,
  CreateKnowledgeDocumentUploadBody,
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

/**
 * The recipes the route accepts. Stated as `choices` like every other
 * constrained flag in this CLI, so `--help` lists them and a typo is refused
 * before the file is uploaded rather than after.
 */
type UploadRecipe = NonNullable<
  NonNullable<CreateKnowledgeDocumentUploadBody['processingOptions']>['recipe']
>
const UPLOAD_RECIPES = [
  'default',
  'plain',
  'markdown',
  'code',
] as const satisfies readonly UploadRecipe[]

/**
 * The route enforces a shape, not BCP-47 conformance, so the help says the
 * shape and nothing more; a full parser is the route's own deliberate
 * non-goal and reimplementing one here would refuse tags the server accepts.
 */
const LANGUAGE_TAG_HELP =
  'Document language tag: hyphen-separated letter and digit subtags, for example en or en-US'

export function attachKnowledgeDocumentUpload(documents: Command): void {
  documents
    .command('upload')
    .argument('<knowledgeBaseId>', 'Knowledge base to upload into')
    .argument('<path>', 'Local file to upload')
    .allowExcessArguments(false)
    .description('Upload a document to a knowledge base')
    .option('--name <name>', 'Store it under a different name')
    .option('--tag <value...>', 'Document tags, in tag1 through tag7 order')
    .addOption(new Option('--recipe <name>', 'Document processing recipe').choices(UPLOAD_RECIPES))
    .option('--lang <code>', LANGUAGE_TAG_HELP)
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
