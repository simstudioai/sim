import { Command } from 'commander'
import { clientFrom } from '../context.js'
import { bytes, type Column, printList, printRecord, text, timestamp } from '../output/render.js'

interface KnowledgeBase {
  id: string
  name: string
  description: string | null
  docCount: number
  tokenCount: number
  embeddingModel: string
  createdAt: string | null
  updatedAt: string | null
}

interface KnowledgeDocument {
  id: string
  knowledgeBaseId: string
  filename: string
  fileSize: number
  mimeType: string
  processingStatus: string
  chunkCount: number
  tokenCount: number
  enabled: boolean
  createdAt: string | null
}

interface SearchHit {
  documentId: string
  documentName: string | null
  content: string
  chunkIndex: number
  similarity: number
}

const BASE_COLUMNS: Column<KnowledgeBase>[] = [
  { header: 'id', value: (kb) => kb.id },
  { header: 'name', value: (kb) => kb.name },
  { header: 'docs', value: (kb) => String(kb.docCount) },
  { header: 'tokens', value: (kb) => String(kb.tokenCount) },
  { header: 'model', value: (kb) => kb.embeddingModel },
]

const DOCUMENT_COLUMNS: Column<KnowledgeDocument>[] = [
  { header: 'id', value: (doc) => doc.id },
  { header: 'filename', value: (doc) => doc.filename },
  { header: 'size', value: (doc) => bytes(doc.fileSize) },
  { header: 'status', value: (doc) => doc.processingStatus },
  { header: 'chunks', value: (doc) => String(doc.chunkCount) },
  { header: 'created', value: (doc) => timestamp(doc.createdAt) },
]

/** Search hits are long prose; keep the table readable and single-line. */
function preview(content: string): string {
  const collapsed = content.replace(/\s+/g, ' ').trim()
  return collapsed.length <= 80 ? collapsed : `${collapsed.slice(0, 79)}…`
}

export function knowledgeCommand(): Command {
  const knowledge = new Command('knowledge')
    .alias('kb')
    .description('Browse and search knowledge bases')

  knowledge
    .command('list')
    .alias('ls')
    .description('List knowledge bases in a workspace')
    .action(async (_options: unknown, command: Command) => {
      const { client, profile } = clientFrom(command)
      const page = await client.getPage<KnowledgeBase>('/api/v2/knowledge', {
        query: { workspaceId: client.requireWorkspace() },
      })
      printList(profile.output, page.data, BASE_COLUMNS)
    })

  knowledge
    .command('get <id>')
    .description('Show one knowledge base')
    .action(async (id: string, _options: unknown, command: Command) => {
      const { client, profile } = clientFrom(command)
      const { knowledgeBase } = await client.getData<{ knowledgeBase: KnowledgeBase }>(
        `/api/v2/knowledge/${id}`,
        { query: { workspaceId: client.requireWorkspace() } }
      )

      printRecord(
        profile.output,
        [
          ['ID', knowledgeBase.id],
          ['Name', knowledgeBase.name],
          ['Description', text(knowledgeBase.description)],
          ['Documents', String(knowledgeBase.docCount)],
          ['Tokens', String(knowledgeBase.tokenCount)],
          ['Embedding model', knowledgeBase.embeddingModel],
          ['Updated', timestamp(knowledgeBase.updatedAt)],
        ],
        knowledgeBase
      )
    })

  knowledge
    .command('documents <id>')
    .alias('docs')
    .description('List the documents in a knowledge base')
    .option('--search <text>', 'Filter by filename')
    .option('--status <status>', 'Filter by enabled state: all, enabled, or disabled', 'all')
    .option('--limit <n>', 'Maximum documents to return', '50')
    .action(
      async (
        id: string,
        options: { search?: string; status: string; limit: string },
        command: Command
      ) => {
        const { client, profile } = clientFrom(command)
        const limit = Number.parseInt(options.limit, 10)

        const rows = await client.collect<KnowledgeDocument>(
          `/api/v2/knowledge/${id}/documents`,
          {
            query: {
              workspaceId: client.requireWorkspace(),
              search: options.search,
              enabledFilter: options.status,
              limit: Math.min(limit, 100),
            },
          },
          limit
        )

        printList(profile.output, rows, DOCUMENT_COLUMNS)
      }
    )

  knowledge
    .command('search <query>')
    .description('Vector-search one or more knowledge bases')
    .requiredOption('--kb <id...>', 'Knowledge base ids to search')
    .option('--top-k <n>', 'Number of hits to return', '10')
    .action(async (query: string, options: { kb: string[]; topK: string }, command: Command) => {
      const { client, profile } = clientFrom(command)

      const result = await client.getData<{ results: SearchHit[]; totalResults: number }>(
        '/api/v2/knowledge/search',
        {
          method: 'POST',
          body: {
            workspaceId: client.requireWorkspace(),
            knowledgeBaseIds: options.kb,
            query,
            topK: Number.parseInt(options.topK, 10),
          },
        }
      )

      printList<SearchHit>(profile.output, result.results, [
        { header: 'score', value: (hit) => hit.similarity.toFixed(3) },
        { header: 'document', value: (hit) => text(hit.documentName ?? hit.documentId) },
        { header: 'chunk', value: (hit) => String(hit.chunkIndex) },
        { header: 'content', value: (hit) => preview(hit.content) },
      ])
    })

  return knowledge
}
