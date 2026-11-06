import type { Command } from 'commander'
import type {
  CompleteKnowledgeImportResponse,
  CreateKnowledgeImportResponse,
  GetKnowledgeImportResponse,
} from '../../generated/v2-api'
import { SimApiError } from '../../http/client'
import { apiCommand } from '../../runtime/called-operations'
import { watchImport } from '../../transfer/import-watch'
import { contentTypeFor, localFile } from '../../transfer/local-file'
import { finishUploadSession } from '../../transfer/upload-session'
import { printProtocolResult } from './result'

type KnowledgeImport = GetKnowledgeImportResponse['data']

interface KnowledgeImportOptions {
  name?: string
  wait: boolean
}

/**
 * What the caller sees about an import. Failures are flattened to text because
 * the result printer renders every field with `String(value)`, and only appear
 * when a document was skipped, so a clean import keeps a short result.
 */
function importFields(job: KnowledgeImport): Record<string, unknown> {
  return {
    id: job.id,
    status: job.status,
    knowledgeBaseId: job.knowledgeBaseId,
    documentsTotal: job.documentsTotal,
    documentsImported: job.documentsImported,
    documentsFailed: job.documentsFailed,
    vectorsReused: job.vectorsReused,
    ...(job.failures.length > 0
      ? { failures: job.failures.map(({ filename, message }) => `${filename}: ${message}`) }
      : {}),
  }
}

function progressLine(job: KnowledgeImport): string {
  const failed = job.documentsFailed > 0 ? `, ${job.documentsFailed} failed` : ''
  return `${job.status}… ${job.documentsImported}/${job.documentsTotal} documents${failed}`
}

export function attachKnowledgeImport(knowledge: Command): void {
  const [importCommand, connectImport] = apiCommand(knowledge, 'import', [
    'createKnowledgeImport',
    'createKnowledgeImportPartUrls',
    'completeKnowledgeImport',
    'cancelKnowledgeImport',
    'getKnowledgeImport',
  ])
  importCommand
    .argument('<path>', 'Bundle archive written by `sim knowledge export`')
    .allowExcessArguments(false)
    .description('Create a knowledge base from an exported .simkb.zip bundle')
    .option('--name <name>', "Name for the new knowledge base; defaults to the bundle's own name")
    .option('--no-wait', 'Return once the import is started instead of watching it')
    .action(async (path: string, options: KnowledgeImportOptions) => {
      const { client, profile } = connectImport()
      const workspaceId = client.requireWorkspace()
      const local = await localFile(path)
      if (!local.name.toLowerCase().endsWith('.zip')) {
        throw new SimApiError('A knowledge base bundle must be a .zip archive', 0)
      }

      const started = await client.request<CreateKnowledgeImportResponse>('createKnowledgeImport', {
        body: {
          workspaceId,
          ...(options.name !== undefined ? { name: options.name } : {}),
          source: {
            type: 'upload',
            name: local.name,
            contentType: contentTypeFor(local.name),
            size: local.size,
          },
        },
      })
      const job: CompleteKnowledgeImportResponse['data'] = await finishUploadSession(
        client,
        workspaceId,
        {
          operations: {
            parts: 'createKnowledgeImportPartUrls',
            complete: 'completeKnowledgeImport',
            abort: 'cancelKnowledgeImport',
          },
          params: { importId: started.data.session.id },
          uploadToken: started.data.uploadToken,
          transfer: started.data.transfer,
          size: local.size,
        },
        path
      )

      if (!options.wait) {
        printProtocolResult(profile.output, importFields(job))
        return
      }
      const finished = await watchImport(
        job,
        async (current) =>
          (
            await client.request<{ data: KnowledgeImport }>('getKnowledgeImport', {
              params: { importId: current.id },
              query: { workspaceId },
            })
          ).data,
        progressLine
      )
      if (finished.status !== 'completed') {
        throw new SimApiError(
          `Import ${finished.status}${finished.error ? `: ${finished.error}` : ''}`,
          0
        )
      }
      printProtocolResult(profile.output, importFields(finished))
    })
}
