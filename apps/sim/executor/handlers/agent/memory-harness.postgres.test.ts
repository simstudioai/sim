/**
 * @vitest-environment node
 *
 * Opt-in harness: AGENT_MEMORY_TEST_DATABASE_URL must point to disposable local PostgreSQL.
 * Run from apps/sim with `bun run test executor/handlers/agent/memory-harness.postgres.test.ts`.
 * AGENT_MEMORY_TEST_LIVE=1 uses configured OpenAI/Anthropic credentials and synthetic PDFs.
 * Otherwise only provider HTTP responses are simulated; storage, SQL, hydration, dispatch,
 * SDK request construction, response parsing, and memory persistence execute real code.
 * Account policy/key lookup use fixtures, Redis uses the in-memory fallback, and no API route runs.
 * AGENT_MEMORY_TEST_REPORT optionally writes SQL snapshots and outgoing attachment hashes.
 */
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateId, generateShortId } from '@sim/utils/id'
import { sql } from 'drizzle-orm'
import { getTableConfig, PgDialect, type PgTable } from 'drizzle-orm/pg-core'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import postgres from 'postgres'
import { fetch as networkFetch } from 'undici'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  database: undefined as PostgresJsDatabase | undefined,
  uploads: '',
}))

vi.unmock('drizzle-orm')
vi.unmock('@sim/db/schema')
vi.mock('@sim/db', () => ({
  db: new Proxy(
    {},
    {
      get(_target, property) {
        if (!fixture.database) throw new Error('Harness database is not initialized')
        const value = Reflect.get(fixture.database, property)
        return typeof value === 'function' ? value.bind(fixture.database) : value
      },
    }
  ),
}))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixture.uploads
  },
}))
/** Fixture principals and explicit keys replace account configuration, not file authorization. */
vi.mock('@/ee/access-control/utils/permission-check', () => ({
  assertPermissionsAllowed: async () => {},
  validateModelProvider: async () => {},
  validateBlockType: async () => {},
}))
vi.mock('@/lib/api-key/byok', () => ({
  getApiKeyWithBYOK: async (
    _provider: string,
    _model: string,
    _workspace: string,
    apiKey: string
  ) => ({ apiKey, isBYOK: true }),
}))

import {
  memory,
  memorySecretProvenance,
  workspaceFileSecretProvenance,
  workspaceFiles,
} from '@sim/db/schema'
import { hashDurableSecretProvenanceValue } from '@/lib/execution/durable-secret-provenance'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution/execution-file-manager'
import { EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { deleteFile } from '@/lib/uploads/core/storage-service'
import { AgentBlockHandler } from '@/executor/handlers/agent/agent-handler'
import type { AgentInputs, Message } from '@/executor/handlers/agent/types'
import type { ExecutionContext, StreamingExecution, UserFile } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { createAgentStreamPump } from '@/providers/stream-pump'
import type { SerializedBlock } from '@/serializer/types'

const databaseUrl = process.env.AGENT_MEMORY_TEST_DATABASE_URL
if (databaseUrl && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)) {
  throw new Error('The Agent memory harness requires a disposable local database')
}
const live = process.env.AGENT_MEMORY_TEST_LIVE === '1'
const schemaName = `agent_memory_${generateId().replaceAll('-', '')}`
const connection = databaseUrl
  ? postgres(databaseUrl, {
      max: 3,
      connection: { search_path: schemaName },
      onnotice: () => {},
    })
  : undefined
const scope = { workspaceId: generateId(), workflowId: generateId(), userId: generateId() }
const block = {
  id: generateId(),
  metadata: { id: 'agent', name: 'Memory harness' },
  position: { x: 0, y: 0 },
  config: { tool: '', params: {} },
  inputs: {},
  outputs: {},
  enabled: true,
} as SerializedBlock
const models = {
  openai: process.env.AGENT_MEMORY_TEST_OPENAI_MODEL || 'gpt-4.1-mini',
  anthropic: process.env.AGENT_MEMORY_TEST_ANTHROPIC_MODEL || 'claude-haiku-4-5',
} as const
type Provider = keyof typeof models
interface WireRequest {
  host: string
  body: Record<string, unknown>
}
interface StoredConversation {
  data: Message[]
  secret_provenance_version: number
  content_hash: string
  status: string
  entries: unknown[]
}
const report: Array<Record<string, unknown>> = []
let outbound: WireRequest[] = []
let transportReply = 'READY'

function apiKey(provider: Provider): string {
  if (!live) return 'synthetic-harness-key'
  const value =
    provider === 'openai'
      ? process.env.OPENAI_API_KEY
      : process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY_1
  if (!value) throw new Error(`Live harness requires a configured ${provider} API key`)
  return value
}

function context(streaming = false): ExecutionContext {
  return {
    ...scope,
    executionId: generateId(),
    principal: {
      kind: 'system',
      serviceId: 'schedule',
      workspaceId: scope.workspaceId,
      workflowId: scope.workflowId,
    },
    stream: streaming,
    selectedOutputs: [block.id],
    blockStates: new Map(),
    blockLogs: [],
    metadata: { startTime: new Date().toISOString(), duration: 0 },
    environmentVariables: {},
    decisions: { router: new Map(), condition: new Map() },
    loopExecutions: new Map(),
    completedLoops: new Set(),
    executedBlocks: new Set(),
    activeExecutionPath: new Set(),
    workflow: { blocks: [], connections: [], loops: {}, version: '1' },
    resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry([], scope),
  } as ExecutionContext
}

/** Use the executor's stream pump and completion hook to persist streamed assistant turns. */
async function executeTurn(ctx: ExecutionContext, inputs: AgentInputs): Promise<string> {
  const result = await new AgentBlockHandler().execute(ctx, block, inputs)
  if (!ctx.stream) return String(result.content)
  expect(result).toHaveProperty('stream')
  const streamingResult = result as StreamingExecution
  expect(streamingResult.onFullContent).toBeTypeOf('function')
  const pump = createAgentStreamPump({
    source: streamingResult.stream,
    streamFormat: streamingResult.streamFormat ?? 'text',
    sinkMode: true,
  })
  const drained = await pump.run()
  expect(drained.fullyDrained).toBe(true)
  expect(drained.cancelled).toBe(false)
  await streamingResult.onFullContent!(drained.answerText)
  return drained.answerText
}

/** Generate only the four production tables exercised here; unrelated application FKs are omitted. */
async function createTable(table: PgTable): Promise<void> {
  if (!connection) throw new Error('Missing harness database')
  const dialect = new PgDialect()
  const config = getTableConfig(table)
  const columns = config.columns.map((column) => {
    const defaultValue =
      column.dataType === 'json' && column.default !== undefined
        ? sql`${JSON.stringify(column.default)}::jsonb`
        : sql`${column.default}`
    const defaultSql =
      column.default === undefined
        ? ''
        : ` DEFAULT ${dialect.sqlToQuery(defaultValue.inlineParams()).sql}`
    return `"${column.name}" ${column.getSQLType()}${column.primary ? ' PRIMARY KEY' : ''}${column.notNull ? ' NOT NULL' : ''}${defaultSql}`
  })
  await connection.unsafe(`CREATE TABLE "${config.name}" (${columns.join(', ')})`)
}

async function readConversation(key: string): Promise<StoredConversation> {
  if (!connection) throw new Error('Missing harness database')
  const [row] = await connection<StoredConversation[]>`
    SELECT m.data, m.secret_provenance_version, p.content_hash, p.status, p.entries
    FROM memory m LEFT JOIN memory_secret_provenance p ON p.memory_id = m.id
    WHERE m.workspace_id = ${scope.workspaceId} AND m.key = ${key}`
  if (!row) throw new Error('Conversation was not persisted')
  expect(row.secret_provenance_version).toBe(1)
  expect(row.status).toBe('exact')
  expect(row.content_hash).toBe(hashDurableSecretProvenanceValue(row.data))
  expect(row.entries).toEqual([])
  return row
}

function requestFiles(request: WireRequest): string[] {
  const messages = request.host === 'api.openai.com' ? request.body.input : request.body.messages
  if (!Array.isArray(messages)) throw new Error('Provider did not send a message array')
  return messages.flatMap((message) => {
    if (!Array.isArray(message.content)) return []
    return message.content.flatMap((part: Record<string, unknown>) => {
      if (part.type === 'input_file' && typeof part.file_data === 'string')
        return [part.file_data.split(',')[1]]
      if (
        part.type === 'document' &&
        part.source &&
        typeof part.source === 'object' &&
        'data' in part.source
      ) {
        return [String(part.source.data)]
      }
      return []
    })
  })
}

async function interceptFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init)
  const url = new URL(request.url)
  if (!['api.openai.com', 'api.anthropic.com'].includes(url.hostname)) {
    throw new Error(`Unexpected harness network destination: ${url.hostname}`)
  }
  const text = await request.text()
  const body = JSON.parse(text) as Record<string, unknown>
  outbound.push({ host: url.hostname, body })
  if (live) {
    const response = await networkFetch(url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: text,
      signal: AbortSignal.timeout(60_000),
    })
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: Object.fromEntries(response.headers),
    })
  }
  const content = transportReply
  const response =
    url.hostname === 'api.openai.com'
      ? {
          id: 'resp_harness',
          object: 'response',
          status: 'completed',
          model: body.model,
          output: [
            {
              id: 'msg_harness',
              type: 'message',
              role: 'assistant',
              status: 'completed',
              content: [{ type: 'output_text', text: content, annotations: [] }],
            },
          ],
          usage: { input_tokens: 100, output_tokens: 8, total_tokens: 108 },
        }
      : {
          id: 'msg_harness',
          type: 'message',
          role: 'assistant',
          model: body.model,
          content: [{ type: 'text', text: content }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 8 },
        }
  if (!body.stream) return Response.json(response)
  const events =
    url.hostname === 'api.openai.com'
      ? [
          { type: 'response.output_text.delta', delta: content },
          { type: 'response.completed', response },
        ]
      : [
          { type: 'message_start', message: { ...response, content: [] } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: content } },
          { type: 'content_block_stop', index: 0 },
          {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 8 },
          },
          { type: 'message_stop' },
        ]
  return new Response(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'Content-Type': 'text/event-stream' } }
  )
}

describe.skipIf(!databaseUrl)(
  'Agent memory through PostgreSQL, storage, and provider transports',
  () => {
    beforeAll(async () => {
      if (!connection) throw new Error('Missing harness database')
      fixture.uploads = await mkdtemp(join(tmpdir(), 'sim-memory-files-'))
      await connection`CREATE SCHEMA ${connection(schemaName)}`
      fixture.database = drizzle(connection)
      for (const table of [
        memory,
        memorySecretProvenance,
        workspaceFiles,
        workspaceFileSecretProvenance,
      ])
        await createTable(table)
      await connection.unsafe(
        `CREATE UNIQUE INDEX memory_workspace_key_idx ON memory(workspace_id, key)`
      )
      await connection.unsafe(
        `CREATE UNIQUE INDEX workspace_files_key_active_unique ON workspace_files(key) WHERE deleted_at IS NULL`
      )
      await connection.unsafe(`
      CREATE FUNCTION demote_memory() RETURNS trigger LANGUAGE plpgsql AS $body$
      BEGIN NEW.secret_provenance_version := NULL; RETURN NEW; END; $body$;
      CREATE TRIGGER memory_demote BEFORE UPDATE OF data ON memory FOR EACH ROW
      WHEN(OLD.data IS DISTINCT FROM NEW.data) EXECUTE FUNCTION demote_memory();
    `)
    })

    afterAll(async () => {
      try {
        if (process.env.AGENT_MEMORY_TEST_REPORT) {
          await writeFile(
            process.env.AGENT_MEMORY_TEST_REPORT,
            JSON.stringify({ live, cases: report }, null, 2)
          )
        }
        if (connection) await connection`DROP SCHEMA IF EXISTS ${connection(schemaName)} CASCADE`
      } finally {
        fixture.database = undefined
        if (connection) await connection.end()
        if (fixture.uploads) await rm(fixture.uploads, { recursive: true, force: true })
        vi.unstubAllGlobals()
      }
    })

    it.each(
      (
        [
          { first: 'openai', second: 'openai', source: 'files' },
          { first: 'anthropic', second: 'anthropic', source: 'messages' },
          { first: 'openai', second: 'anthropic', source: 'userPrompt' },
          { first: 'anthropic', second: 'openai', source: 'files' },
        ] as const
      ).flatMap((scenario) => [false, true].map((streaming) => ({ ...scenario, streaming })))
    )(
      '$first → $second, using $source, streaming=$streaming',
      async ({ first, second, source, streaming }) => {
        vi.stubGlobal('fetch', interceptFetch)
        outbound = []
        const conversationId = generateId()
        const firstContext = context(streaming)
        const marker = `PROBE-${generateShortId()}`
        const pdf = await PDFDocument.create()
        const font = await pdf.embedFont(StandardFonts.Helvetica)
        pdf.addPage().drawText(`memory_probe = ${marker}`, { x: 40, y: 700, size: 18, font })
        const buffer = Buffer.from(await pdf.save())
        const file = await uploadExecutionFile(
          {
            workspaceId: scope.workspaceId,
            workflowId: scope.workflowId,
            executionId: firstContext.executionId!,
          },
          buffer,
          'memory-probe.pdf',
          'application/pdf',
          scope.userId,
          EXACT_EMPTY_WORKSPACE_FILE_SECRET_PROVENANCE
        )
        expect(file.key).toContain(firstContext.executionId)
        if (!connection) throw new Error('Missing harness database')
        /** Production provenance compares JavaScript Dates, so compare versions at millisecond precision. */
        const [storedFile] = await connection`
          SELECT f.id, f.key, f.workspace_id, f.context, f.original_name, f.content_type,
            f.size_bytes::integer AS size_bytes, f.secret_provenance_version,
            p.status, p.entries,
            date_trunc('milliseconds', f.content_updated_at) = p.content_updated_at AS provenance_bound
          FROM workspace_files f
          LEFT JOIN workspace_file_secret_provenance p ON p.file_id = f.id
          WHERE f.key = ${file.key!}`
        expect(storedFile).toEqual({
          id: file.id,
          key: file.key,
          workspace_id: scope.workspaceId,
          context: 'execution',
          original_name: 'memory-probe.pdf',
          content_type: 'application/pdf',
          size_bytes: buffer.length,
          secret_provenance_version: 1,
          status: 'exact',
          entries: [],
          provenance_bound: true,
        })
        const firstPrompt =
          'Read the attached PDF. Reply exactly READY. Do not quote or mention anything from the file.'
        const firstInputs: AgentInputs = {
          model: models[first],
          apiKey: apiKey(first),
          maxTokens: '128',
          memoryType: 'conversation',
          conversationId,
          ...(source === 'userPrompt'
            ? { userPrompt: firstPrompt, files: [file] }
            : {
                messages: [
                  {
                    role: 'user',
                    content: firstPrompt,
                    ...(source === 'messages' ? { files: [file] } : {}),
                  },
                ],
                ...(source === 'files' ? { files: [file] } : {}),
              }),
        }
        transportReply = 'READY'
        expect(await executeTurn(firstContext, firstInputs)).toBe('READY')
        const firstStored = await readConversation(conversationId)
        expect(firstStored.data.map((message) => message.role)).toEqual(['user', 'assistant'])
        const reference: UserFile = {
          id: file.id,
          name: file.name,
          key: file.key,
          url: '',
          size: buffer.length,
          type: 'application/pdf',
          context: 'execution',
        }
        expect(firstStored.data[0].files).toEqual([reference])
        expect(JSON.stringify(firstStored)).not.toContain(marker)
        expect(JSON.stringify(firstStored)).not.toContain('base64')
        expect(JSON.stringify(firstStored)).not.toContain('providerFile')
        expect(requestFiles(outbound[0])).toEqual([buffer.toString('base64')])

        /** Fresh handler, execution, and registry force a DB read and a new execution-scoped byte cache. */
        const secondContext = context(streaming)
        transportReply = marker
        const followupInputs: AgentInputs = {
          model: models[second],
          apiKey: apiKey(second),
          maxTokens: '128',
          memoryType: 'conversation',
          conversationId,
          messages: [
            {
              role: 'user',
              content:
                'What is the memory_probe value from the PDF I attached earlier? Reply exactly the value. If no PDF is available, reply NO_FILE.',
            },
          ],
        }
        expect(await executeTurn(secondContext, followupInputs)).toBe(marker)
        expect(secondContext.fileKeys).toEqual([file.key])
        expect(outbound).toHaveLength(2)
        expect(outbound.every((request) => Boolean(request.body.stream) === streaming)).toBe(true)
        expect(requestFiles(outbound[1])).toEqual([buffer.toString('base64')])
        const secondStored = await readConversation(conversationId)
        expect(secondStored.data.map((message) => message.role)).toEqual([
          'user',
          'assistant',
          'user',
          'assistant',
        ])
        expect(secondStored.data[0]).toEqual(firstStored.data[0])
        expect(secondStored.data[2].files).toBeUndefined()
        expect(secondStored.data[3].content).toBe(marker)

        transportReply = 'NO_FILE'
        const unrelatedConversationId = generateId()
        const unrelatedContext = context(streaming)
        expect(
          await executeTurn(unrelatedContext, {
            ...followupInputs,
            conversationId: unrelatedConversationId,
          })
        ).toBe('NO_FILE')
        expect(unrelatedContext.fileKeys ?? []).toEqual([])
        expect(outbound).toHaveLength(3)
        expect(requestFiles(outbound[2])).toEqual([])
        const unrelatedStored = await readConversation(unrelatedConversationId)
        expect(unrelatedStored.data).toHaveLength(2)
        expect(unrelatedStored.data.every((message) => !message.files)).toBe(true)

        const otherWorkflow = context(streaming)
        otherWorkflow.workflowId = generateId()
        otherWorkflow.principal = {
          kind: 'system',
          serviceId: 'schedule',
          workspaceId: scope.workspaceId,
          workflowId: otherWorkflow.workflowId,
        }
        await expect(executeTurn(otherWorkflow, followupInputs)).rejects.toThrow(
          'could not be read'
        )
        expect(outbound).toHaveLength(3)

        await deleteFile({ key: file.key!, context: 'execution' })
        await expect(executeTurn(context(streaming), followupInputs)).rejects.toThrow(
          'could not be read'
        )
        expect(outbound).toHaveLength(3)
        const afterDeletion = await readConversation(conversationId)
        expect(afterDeletion.data[0].files).toEqual([reference])
        report.push({
          first,
          second,
          source,
          streaming,
          marker,
          storedFile,
          firstStored,
          secondStored,
          controls: {
            unrelatedConversation: 'passed',
            differentWorkflow: 'blocked before HTTP',
            missingSource: 'blocked before HTTP',
          },
          transports: outbound.map((request) => ({
            host: request.host,
            fileCount: requestFiles(request).length,
            fileSha256: requestFiles(request).map((base64) =>
              createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex')
            ),
          })),
          passed: true,
        })
      },
      150_000
    )
  }
)
