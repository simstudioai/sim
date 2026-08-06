/**
 * @vitest-environment node
 */
import { flattenMockConditions, type MockCondition } from '@sim/testing'
import { describe, expect, it } from 'vitest'
import {
  buildConversationListingFilters,
  type ConversationRow,
  conversationToStub,
  decodeCursor,
  encodeCursor,
  escapeLikePrefix,
  parseOptionalPositiveInt,
  renderTranscript,
} from '@/connectors/sim-conversations/sim-conversations'

const BASE_ROW: ConversationRow = {
  id: 'mem-1',
  key: 'support-123',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  messageCount: 6,
  approxBytes: 1024,
}

const META = {
  conversationId: 'support-123',
  startedAt: '2026-01-01T00:00:00.000Z',
  lastActivity: '2026-01-02T00:00:00.000Z',
}

function conditionsOf(
  args: Parameters<typeof buildConversationListingFilters>[0]
): MockCondition[] {
  return buildConversationListingFilters(args).flatMap(flattenMockConditions)
}

describe('escapeLikePrefix', () => {
  /**
   * The whole point of the filter. Unescaped, a prefix of `%` matches every
   * conversation in the workspace, turning a narrow scope into a full export.
   */
  it('escapes LIKE wildcards so they match literally', () => {
    expect(escapeLikePrefix('%')).toBe('\\%')
    expect(escapeLikePrefix('_')).toBe('\\_')
    expect(escapeLikePrefix('100%_done')).toBe('100\\%\\_done')
  })

  it('escapes the escape character itself', () => {
    expect(escapeLikePrefix('a\\b')).toBe('a\\\\b')
  })

  it('leaves ordinary prefixes untouched', () => {
    expect(escapeLikePrefix('support-')).toBe('support-')
    expect(escapeLikePrefix('')).toBe('')
  })
})

describe('buildConversationListingFilters', () => {
  /** The tenancy invariant: only the engine-supplied workspace can scope the query. */
  it('always binds the supplied workspace, and nothing else can widen it', () => {
    const nodes = conditionsOf({ workspaceId: 'ws-real', prefix: '' })
    const workspaceClause = nodes.find((node) => node.left === 'workspaceId')

    expect(workspaceClause).toMatchObject({ type: 'eq', right: 'ws-real' })
    expect(JSON.stringify(nodes)).not.toContain('victim-ws')
  })

  /**
   * `Memory.fetchMemory` omits this filter; copying that omission would resurrect
   * conversations a workspace has already deleted.
   */
  it('excludes soft-deleted conversations', () => {
    const nodes = conditionsOf({ workspaceId: 'ws-1', prefix: '' })
    expect(nodes.map((node) => node.column ?? node.left)).toContain('deletedAt')
  })

  it('adds a prefix filter only when a prefix is configured', () => {
    expect(conditionsOf({ workspaceId: 'ws-1', prefix: '' })).toHaveLength(2)
    expect(conditionsOf({ workspaceId: 'ws-1', prefix: 'support-' }).length).toBeGreaterThan(2)
  })

  it('adds a keyset clause only when paginating', () => {
    const first = conditionsOf({ workspaceId: 'ws-1', prefix: '' })
    const next = conditionsOf({
      workspaceId: 'ws-1',
      prefix: '',
      cursor: { updatedAt: new Date('2026-01-01T00:00:00.000Z'), id: 'mem-1' },
    })

    expect(first.some((node) => node.type === 'or')).toBe(false)
    expect(next.some((node) => node.type === 'or')).toBe(true)
  })
})

describe('renderTranscript', () => {
  it('renders roles as headings in order', () => {
    const content = renderTranscript(META, [
      { role: 'user', content: 'how do I reset my key?' },
      { role: 'assistant', content: 'Open Settings, then API Keys.' },
    ])

    expect(content).toContain('# Conversation: support-123')
    expect(content).toContain('## User\n\nhow do I reset my key?')
    expect(content).toContain('## Assistant\n\nOpen Settings, then API Keys.')
    expect(content.indexOf('## User')).toBeLessThan(content.indexOf('## Assistant'))
  })

  it('reports the true message count in the header', () => {
    const content = renderTranscript(META, [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ])
    expect(content).toContain('- Messages: 3')
  })

  /**
   * `data` is untyped jsonb, so it can hold legacy or partially-written shapes. The
   * filter mirrors `Memory.fetchMemory` so a transcript never contains anything the
   * agent itself would not read back.
   */
  it('drops entries the agent would not read back', () => {
    const content = renderTranscript(META, [
      { role: 'user', content: 'kept' },
      { role: 'tool', content: 'unknown role' },
      { role: 'assistant', content: 42 },
      { role: 'assistant' },
      null,
      'not an object',
    ])

    expect(content).toContain('kept')
    expect(content).not.toContain('unknown role')
    expect(content).not.toContain('42')
    expect(content).toContain('- Messages: 1')
  })

  it('tolerates a non-array data column', () => {
    for (const value of [null, undefined, {}, 'oops', 7]) {
      const content = renderTranscript(META, value)
      expect(content).toContain('- Messages: 0')
    }
  })

  it('normalizes CRLF and trims each message', () => {
    const content = renderTranscript(META, [{ role: 'user', content: '  line1\r\nline2  ' }])
    expect(content).toContain('line1\nline2')
    expect(content).not.toContain('\r')
  })

  /** Recent turns are what an agent owner is analyzing, so truncation keeps the tail. */
  it('keeps the most recent messages when truncating and says so', () => {
    const messages = Array.from({ length: 5_010 }, (_, index) => ({
      role: 'user',
      content: `message-${index}`,
    }))

    const content = renderTranscript(META, messages)

    expect(content).toContain('- Messages: 5010')
    expect(content).toContain('only the most recent 5000 messages are indexed')
    expect(content).toContain('message-5009')
    expect(content).not.toContain('message-0\n')
  })

  it('omits the truncation note when nothing was dropped', () => {
    const content = renderTranscript(META, [{ role: 'user', content: 'short' }])
    expect(content).not.toContain('only the most recent')
  })
})

describe('conversationToStub', () => {
  it('defers content and carries tag metadata', () => {
    const stub = conversationToStub(BASE_ROW)

    expect(stub.externalId).toBe('mem-1')
    expect(stub.title).toBe('Conversation: support-123')
    expect(stub.contentDeferred).toBe(true)
    expect(stub.sourceUrl).toBeUndefined()
    expect(stub.metadata).toMatchObject({
      conversationId: 'support-123',
      messageCount: 6,
      fileSize: 1024,
    })
  })

  it('hashes on the update watermark, which moves whenever a message is appended', () => {
    const base = conversationToStub(BASE_ROW).contentHash
    expect(base).toBe('memory:mem-1:2026-01-02T00:00:00.000Z')

    const appended = conversationToStub({
      ...BASE_ROW,
      updatedAt: new Date('2026-01-03T00:00:00.000Z'),
      messageCount: 8,
    })
    expect(appended.contentHash).not.toBe(base)
  })

  it('is deterministic for the same row', () => {
    expect(conversationToStub(BASE_ROW).contentHash).toBe(
      conversationToStub({ ...BASE_ROW }).contentHash
    )
  })
})

describe('cursor', () => {
  it('round-trips a keyset position', () => {
    const row = { updatedAt: new Date('2026-01-02T03:04:05.678Z'), id: 'mem-9' }
    const decoded = decodeCursor(encodeCursor(row))

    expect(decoded.id).toBe('mem-9')
    expect(decoded.updatedAt.toISOString()).toBe(row.updatedAt.toISOString())
  })

  it('throws on a malformed cursor rather than restarting the listing', () => {
    expect(() => decodeCursor('nonsense')).toThrow(/Malformed/)
    expect(() => decodeCursor('2026-01-01T00:00:00.000Z|')).toThrow(/Malformed/)
  })
})

describe('parseOptionalPositiveInt', () => {
  it('treats blank values as unset and rejects non-positive integers', () => {
    expect(parseOptionalPositiveInt('')).toBeUndefined()
    expect(parseOptionalPositiveInt('2')).toBe(2)
    expect(parseOptionalPositiveInt('0')).toBeNull()
    expect(parseOptionalPositiveInt('1.5')).toBeNull()
  })
})
