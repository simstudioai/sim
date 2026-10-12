/**
 * Non-Chat callers of every use case that gates Chat's content delivery, compared byte for byte
 * against a snapshot recorded before the gate existed. API keys, OAuth, MCP and the UI read the
 * same content, unclassified, whatever its secret provenance: only a Chat surface installs a gate.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { rateLimiterMock } from '@sim/testing/mocks/rate-limiter.mock'
import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const fixtureStorage = vi.hoisted(() => ({ root: '' }))
vi.mock('@/lib/uploads/core/setup.server', () => ({
  get UPLOAD_DIR_SERVER() {
    return fixtureStorage.root
  },
}))
/** Admission throughput is not what this suite proves. */
vi.mock('@/lib/core/rate-limiter', () => rateLimiterMock)
vi.mock('@/lib/embeddings', async () => ({
  ...(await import('@/lib/embeddings/client')),
  assertKnowledgeEmbeddingCapacity: async () => {},
  embedKnowledge: async (texts: string[]) => ({
    embeddings: texts.map(() => [1, ...Array<number>(1535).fill(0)]),
    totalTokens: texts.length,
    billableTokens: 0,
    isBYOK: true,
    modelName: 'text-embedding-3-small',
    pricingId: 'text-embedding-3-small',
  }),
}))

import {
  type ContentFixture,
  callV2,
  removeContentFixture,
  seedContentFixture,
} from '@/lib/mothership/__integration__/content-delivery-fixture'

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
/** Fields whose value is minted per write: storage keys and share tokens. */
const MINTED_FIELDS = new Set(['key', 'token'])

/**
 * A URL keeps its origin and fixed path, so a wrong host or route still fails; only the segments
 * a write minted (tokens, storage keys: anything but lowercase words) and query values vary.
 */
function normalizeUrl(value: string, labels: Map<string, string>): string {
  if (!URL.canParse(value)) return String(normalize(value, labels))
  const url = new URL(value)
  const path = url.pathname
    .split('/')
    .map((segment) => (/^[a-z-]*$/.test(segment) ? segment : '<minted>'))
    .join('/')
  const query = [...url.searchParams.keys()].sort().join('&')
  return `${url.origin}${path}${query ? `?${query}` : ''}`
}
/**
 * Ranking scores move with whatever else the shared test database indexed (order is pinned below),
 * and a table's `rowCount` is maintained by a migration trigger a pushed schema does not install.
 */
const UNSTABLE_SCORES = new Set(['rank', 'rankScore', 'similarity', 'rowCount'])
const MINTED_ID = /\b(?:col|row|tbl)_[0-9a-f]{32}\b/g

/** Replaces values minted per run (ids, times, tokens) so two runs of the same calls compare equal. */
function normalize(value: unknown, labels: Map<string, string>): unknown {
  if (typeof value === 'string') {
    if (ISO_TIME.test(value)) return '<time>'
    let text = value
    for (const [raw, label] of labels) text = text.split(raw).join(label)
    return text.replace(UUID, '<id>').replace(MINTED_ID, '<id>')
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => normalize(item, labels))
    return items.every((item) => typeof (item as { chunkIndex?: unknown })?.chunkIndex === 'number')
      ? items.sort(
          (left, right) =>
            (left as { chunkIndex: number }).chunkIndex -
            (right as { chunkIndex: number }).chunkIndex
        )
      : items
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [
          key,
          (MINTED_FIELDS.has(key) && typeof item === 'string') || UNSTABLE_SCORES.has(key)
            ? '<minted>'
            : key === 'url' && typeof item === 'string'
              ? normalizeUrl(item, labels)
              : normalize(item, labels),
        ])
    )
  }
  return value
}

async function describeResponse(response: Response, labels: Map<string, string>) {
  const contentType = response.headers.get('content-type') ?? ''
  const status = response.status
  if (contentType.includes('application/json')) {
    return { status, json: normalize(await response.json(), labels) }
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (contentType.includes('zip')) {
    const archive = await JSZip.loadAsync(bytes)
    const entries: Record<string, string> = {}
    for (const name of Object.keys(archive.files).sort()) {
      const entry = archive.files[name]
      if (!entry.dir) entries[name] = await entry.async('string')
    }
    return { status, contentType, zip: normalize(entries, labels) }
  }
  return { status, contentType, text: normalize(bytes.toString('utf8'), labels) }
}

/**
 * Recorded once on the commit before Chat's delivery gate existed and compared semantically, so
 * formatting cannot move it. It is evidence, not an expectation to regenerate: a difference here is
 * a change non-Chat callers would see.
 */
const BASELINE: unknown = JSON.parse(
  readFileSync(path.join(__dirname, 'content-delivery-compat.baseline.json'), 'utf8')
)

describe('non-Chat callers read sourced content unchanged', () => {
  let fixture: ContentFixture
  const labels = new Map<string, string>()

  beforeAll(async () => {
    fixtureStorage.root = mkdtempSync(path.join(tmpdir(), 'sim-content-compat-'))
    fixture = await seedContentFixture()
    labels.set(fixture.ids.workspaceId, '<workspace>')
    labels.set(fixture.ids.aliceId, '<alice>')
    labels.set(fixture.ids.organizationId, '<organization>')
    labels.set(fixture.knowledge.knowledgeBaseId, '<kb>')
    labels.set(fixture.knowledge.documentId, '<document>')
    labels.set(fixture.table.tableId, '<table>')
    labels.set(fixture.run.workflowId, '<workflow>')
    labels.set(fixture.run.runId, '<run>')
    for (const [name, id] of Object.entries(fixture.files)) labels.set(id, `<file:${name}>`)
    for (const [name, id] of Object.entries(fixture.knowledge.chunks))
      labels.set(id, `<chunk:${name}>`)
    for (const [name, id] of Object.entries(fixture.table.rows)) labels.set(id, `<row:${name}>`)
    for (const [name, id] of Object.entries(fixture.run.files)) labels.set(id, `<run-file:${name}>`)
  }, 120_000)

  afterAll(async () => {
    if (fixture) await removeContentFixture(fixture)
    await rm(fixtureStorage.root, { recursive: true, force: true })
  })

  it('answers every shared content route as it did before the gate', async () => {
    const ws = fixture.ids.workspaceId
    const { files, knowledge, table, run } = fixture
    const kb = `/api/v2/knowledge/${knowledge.knowledgeBaseId}`
    const calls: Array<[string, string, unknown?]> = [
      ['GET', '/api/v2/workspaces'],
      ['GET', `/api/v2/files?workspaceId=${ws}`],
      ...Object.values(files).flatMap(
        (id): Array<[string, string]> => [
          ['GET', `/api/v2/files/${id}?workspaceId=${ws}`],
          ['GET', `/api/v2/files/${id}/text?workspaceId=${ws}`],
          ['GET', `/api/v2/files/${id}/versions?workspaceId=${ws}`],
        ]
      ),
      ['GET', `/api/v2/files/bulk-download?workspaceId=${ws}&fileIds=${Object.values(files)}`],
      ['GET', `/api/v2/files/search?workspaceId=${ws}&query=second%20line&mode=exact`],
      [
        'PATCH',
        `/api/v2/files/${files.unknown}/share`,
        { workspaceId: ws, isActive: true, authType: 'public' },
      ],
      ['GET', `/api/v2/knowledge?workspaceId=${ws}`],
      ['GET', `${kb}/documents?workspaceId=${ws}`],
      ['GET', `${kb}/documents/${knowledge.documentId}?workspaceId=${ws}`],
      ['GET', `${kb}/documents/${knowledge.documentId}/chunks?workspaceId=${ws}`],
      ...Object.values(knowledge.chunks).map((id): [string, string] => [
        'GET',
        `${kb}/documents/${knowledge.documentId}/chunks/${id}?workspaceId=${ws}`,
      ]),
      [
        'POST',
        '/api/v2/knowledge/search',
        { workspaceId: ws, knowledgeBaseIds: [knowledge.knowledgeBaseId], query: 'second line' },
      ],
      ['GET', `/api/v2/tables?workspaceId=${ws}`],
      ['GET', `/api/v2/tables/${table.tableId}/rows?workspaceId=${ws}`],
      ...Object.values(table.rows).map((id): [string, string] => [
        'GET',
        `/api/v2/tables/${table.tableId}/rows/${id}?workspaceId=${ws}`,
      ]),
      ['POST', `/api/v2/tables/${table.tableId}/query`, { workspaceId: ws }],
      ['POST', `/api/v2/tables/${table.tableId}/rows/search`, { workspaceId: ws, q: 'second' }],
      ['GET', `/api/v2/workflows?workspaceId=${ws}`],
      [
        'GET',
        `/api/v2/workflows/${run.workflowId}/runs/${run.runId}?includeOutput=true&includeFileBase64=true`,
      ],
      ...Object.values(run.files).map((id): [string, string] => [
        'GET',
        `/api/v2/workflows/${run.workflowId}/runs/${run.runId}/files/${id}`,
      ]),
    ]
    const observed: Record<string, unknown> = {}
    for (const [method, route, body] of calls) {
      const key = `${method} ${normalize(route, labels)}`
      observed[key] = await describeResponse(await callV2(fixture, method, route, body), labels)
    }
    expect(observed).toEqual(BASELINE)
  }, 120_000)
})
