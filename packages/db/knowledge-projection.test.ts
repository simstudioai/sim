import {
  FILL_MARK_CEILING,
  markUnfilledProjectionDocuments,
  runKnowledgeProjection,
} from '@sim/db/knowledge-projection'
import type { Sql } from 'postgres'
import { describe, expect, it, vi } from 'vitest'

interface Mark {
  generation: number
  content: boolean
}

interface FakeDatabase {
  marks: Map<string, Mark>
  /** Documents whose advisory lock another pass holds. */
  lockedElsewhere: Set<string>
  tin: boolean
  /** Chunk count per document, paged by chunk index. */
  chunks: Map<string, number>
  /** Called before each page statement; may throw to fail the page or change marks. */
  beforePage?: (page: { documentId: string; projection: string; after: number }) => void
  /** Called before a settle. */
  beforeSettle?: (documentId: string) => void
}

/** The page statements a pass ran, in order. */
interface Trace {
  pages: Array<{ documentId: string; projection: string; after: number; mode: 'content' | 'acl' }>
  locks: string[]
  unlocks: string[]
  claims: string[][]
}

function postgresError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

/**
 * A stand-in for a postgres.js session that answers the projector's statements from `state`, by
 * the statement's text: enough of the database to drive the pass's control flow.
 */
function fakeSql(state: FakeDatabase): { sql: Sql; trace: Trace } {
  const trace: Trace = { pages: [], locks: [], unlocks: [], claims: [] }
  const answer = async (text: string, values: unknown[]): Promise<unknown[]> => {
    if (text.includes('to_regprocedure')) return [{ installed: state.tin }]
    if (text.includes('ORDER BY marked_at')) {
      const skipped = new Set(values[0] as string[])
      const claimed = [...state.marks.keys()].filter((id) => !skipped.has(id)).slice(0, 50)
      trace.claims.push(claimed)
      return claimed.map((document_id) => ({ document_id }))
    }
    if (text.includes('pg_try_advisory_lock')) {
      const documentId = String(values[0])
      trace.locks.push(documentId)
      return [{ acquired: !state.lockedElsewhere.has(documentId) }]
    }
    if (text.includes('pg_advisory_unlock')) {
      trace.unlocks.push(String(values[0]))
      return []
    }
    if (text.includes('SELECT m.generation')) {
      const mark = state.marks.get(String(values[0]))
      return mark
        ? [{ generation: String(mark.generation), content: mark.content, knowledge_base_id: 'kb' }]
        : []
    }
    if (text.includes('WITH removed AS')) {
      const documentId = String(values[0])
      state.beforeSettle?.(documentId)
      const mark = state.marks.get(documentId)
      if (mark && mark.generation === values[1]) {
        state.marks.delete(documentId)
        return [{ removed: 1, marked: true }]
      }
      return [{ removed: 0, marked: Boolean(mark) }]
    }
    if (text.includes('SELECT EXISTS (SELECT 1 FROM knowledge_projection_dirty')) {
      return [{ marked: state.marks.has(String(values[0])) }]
    }
    return []
  }
  const tagged = (strings: TemplateStringsArray, ...values: unknown[]) =>
    answer(strings.join('?'), values)
  const unsafe = async (text: string, values: unknown[] = []) => {
    if (!text.includes('WITH page AS')) return answer(text, values)
    const [documentId, after, pageSize] = values as [string, number, number]
    const projection =
      /INSERT INTO (\w+)|UPDATE (\w+) s SET/.exec(text)?.slice(1).find(Boolean) ?? 'unknown'
    const mode = text.includes('INSERT INTO') ? 'content' : 'acl'
    state.beforePage?.({ documentId, projection, after })
    trace.pages.push({ documentId, projection, after, mode })
    const total = state.chunks.get(documentId) ?? 1
    const first = after + 1
    const scanned = Math.max(0, Math.min(pageSize, total - first))
    return [
      {
        scanned,
        written: scanned,
        last_chunk: scanned === 0 ? null : first + scanned - 1,
      },
    ]
  }
  const session = Object.assign(tagged, {
    unsafe,
    begin: async (work: (tx: unknown) => Promise<unknown>) =>
      work(Object.assign(tagged, { unsafe })),
  })
  return { sql: session as unknown as Sql, trace }
}

function database(overrides: Partial<FakeDatabase> = {}): FakeDatabase {
  return {
    marks: new Map(),
    lockedElsewhere: new Set(),
    tin: true,
    chunks: new Map(),
    ...overrides,
  }
}

describe('runKnowledgeProjection', () => {
  it('projects every marked document under its lock and removes each mark it settled', async () => {
    const state = database({
      marks: new Map([
        ['doc-a', { generation: 1, content: true }],
        ['doc-b', { generation: 3, content: false }],
      ]),
    })
    const { sql, trace } = fakeSql(state)
    const progress = await runKnowledgeProjection(sql)
    expect(progress).toMatchObject({ settled: 2, deferred: 0, remaining: false })
    expect(state.marks.size).toBe(0)
    expect(trace.locks).toEqual(['doc-a', 'doc-b'])
    expect(trace.unlocks).toEqual(['doc-a', 'doc-b'])
    /** A content mark rewrites every projection; a source and ACL mark only the mirrored ones. */
    expect(trace.pages.filter((page) => page.documentId === 'doc-a')).toEqual([
      { documentId: 'doc-a', projection: 'embedding_search', after: -1, mode: 'content' },
      { documentId: 'doc-a', projection: 'embedding_keyword_search', after: -1, mode: 'content' },
      { documentId: 'doc-a', projection: 'embedding_keyword_tin', after: -1, mode: 'content' },
    ])
    expect(trace.pages.filter((page) => page.documentId === 'doc-b')).toEqual([
      { documentId: 'doc-b', projection: 'embedding_search', after: -1, mode: 'acl' },
      { documentId: 'doc-b', projection: 'embedding_keyword_tin', after: -1, mode: 'acl' },
    ])
  })

  it('keeps a mark whose generation moved while the pass ran', async () => {
    const state = database({ marks: new Map([['doc', { generation: 1, content: false }]]) })
    state.beforeSettle = () => state.marks.set('doc', { generation: 2, content: false })
    const { sql, trace } = fakeSql(state)
    const progress = await runKnowledgeProjection(sql)
    expect(progress).toMatchObject({ settled: 0, deferred: 1, remaining: true })
    expect(state.marks.get('doc')?.generation).toBe(2)
    /** A document given up is not claimed again by the same pass. */
    expect(trace.claims).toEqual([['doc'], []])
  })

  it('leaves a document another pass holds to that pass', async () => {
    const state = database({
      marks: new Map([
        ['held', { generation: 1, content: false }],
        ['free', { generation: 1, content: false }],
      ]),
      lockedElsewhere: new Set(['held']),
    })
    const { sql, trace } = fakeSql(state)
    const progress = await runKnowledgeProjection(sql)
    expect(progress).toMatchObject({ settled: 1, deferred: 1, remaining: true })
    expect(state.marks.has('held')).toBe(true)
    expect(trace.pages.some((page) => page.documentId === 'held')).toBe(false)
    expect(trace.unlocks).toEqual(['free'])
  })

  it.each([
    ['a lock timeout', postgresError('55P03', 'canceling statement due to lock timeout')],
    ['a statement timeout', postgresError('57014', 'canceling statement due to statement timeout')],
    ['a deadlock', postgresError('40P01', 'deadlock detected')],
    ['a chunk deleted under the page', postgresError('23503', 'insert violates foreign key')],
  ])('gives a document up on %s and carries on with the next', async (_, failure) => {
    const state = database({
      marks: new Map([
        ['slow', { generation: 1, content: false }],
        ['fine', { generation: 1, content: false }],
      ]),
    })
    state.beforePage = ({ documentId }) => {
      if (documentId === 'slow') throw failure
    }
    const { sql, trace } = fakeSql(state)
    const progress = await runKnowledgeProjection(sql)
    expect(progress).toMatchObject({ settled: 1, deferred: 1, remaining: true })
    expect(state.marks.has('slow')).toBe(true)
    expect(trace.unlocks).toEqual(['slow', 'fine'])
  })

  it('counts a document deleted during its pass as gone rather than left marked', async () => {
    const state = database({ marks: new Map([['doc', { generation: 1, content: false }]]) })
    state.beforePage = () => {
      state.marks.delete('doc')
      throw postgresError('23503', 'insert violates foreign key')
    }
    const { sql } = fakeSql(state)
    await expect(runKnowledgeProjection(sql)).resolves.toMatchObject({
      settled: 0,
      deferred: 0,
      remaining: false,
    })
  })

  it('fails the pass on any other error, releasing the document it held', async () => {
    const state = database({ marks: new Map([['doc', { generation: 1, content: false }]]) })
    state.beforePage = () => {
      throw postgresError('42P01', 'relation does not exist')
    }
    const { sql, trace } = fakeSql(state)
    await expect(runKnowledgeProjection(sql)).rejects.toThrow('relation does not exist')
    expect(trace.unlocks).toEqual(['doc'])
    expect(state.marks.has('doc')).toBe(true)
  })

  it('stops between pages of a long document at its deadline and keeps that mark', async () => {
    vi.useFakeTimers()
    try {
      const state = database({
        marks: new Map([['long', { generation: 1, content: false }]]),
        chunks: new Map([['long', 10]]),
        tin: false,
      })
      state.beforePage = () => {
        vi.advanceTimersByTime(40)
      }
      const { sql, trace } = fakeSql(state)
      const progress = await runKnowledgeProjection(sql, { budgetMs: 100, pageSize: 2 })
      expect(trace.pages).toHaveLength(3)
      expect(progress).toMatchObject({ settled: 0, deferred: 1, remaining: true })
      expect(state.marks.has('long')).toBe(true)
      expect(trace.unlocks).toEqual(['long'])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('markUnfilledProjectionDocuments', () => {
  /** A session answering the fill's two statements from `outstanding` and a queue of scan results. */
  function fillSql(outstanding: number, scans: Array<{ marked: number; last_id: string | null }>) {
    const statements: Array<{ text: string; values: unknown[] }> = []
    const sql = Object.assign(
      async (strings: TemplateStringsArray) => {
        if (strings.join('').includes('count(*)')) return [{ outstanding }]
        return []
      },
      {
        unsafe: async (text: string, values: unknown[]) => {
          statements.push({ text, values })
          return [scans.shift() ?? { marked: 0, last_id: null }]
        },
      }
    ) as unknown as Sql
    return { sql, statements }
  }

  it('marks nothing while the outstanding marks are at the ceiling', async () => {
    const { sql, statements } = fillSql(FILL_MARK_CEILING, [])
    await expect(markUnfilledProjectionDocuments(sql)).resolves.toEqual({
      marked: 0,
      cursor: { projection: 0, afterId: '' },
    })
    expect(statements).toEqual([])
  })

  it('offers the room left and continues from the row the statement stopped before', async () => {
    const { sql, statements } = fillSql(FILL_MARK_CEILING - 3, [{ marked: 3, last_id: 'row-9' }])
    await expect(markUnfilledProjectionDocuments(sql)).resolves.toEqual({
      marked: 3,
      cursor: { projection: 0, afterId: 'row-9' },
    })
    expect(statements[0]?.text).toContain('FROM embedding_search WHERE acl IS NULL')
    expect(statements[0]?.text).toContain('u.id < held.first_id')
    expect(statements[0]?.values).toEqual(['', 3])
  })
})
