/**
 * Renders the real predicate against the real drizzle dialect and schema. The
 * shared client sets `fetch_types: false` (packages/db/db.ts), under which an
 * array bound as one parameter fails at execution with 22P02, so the assertion
 * that matters is that every bind is a scalar.
 */
import { describe, expect, it, vi } from 'vitest'

vi.unmock('drizzle-orm')
vi.unmock('@sim/db')
vi.unmock('@sim/db/schema')

process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test'

const { PgDialect } = await import('drizzle-orm/pg-core')
const { embeddingSearch } = await import('@sim/db/schema')
const { sql: rawSql } = await import('drizzle-orm')
const sqlColumn = (name: string) => rawSql.raw(`"row"."${name}"`)
const {
  knowledgeAccessCondition,
  knowledgeCandidateAccessConditionForConnectors,
  projectionCandidateAccessCondition,
  restrictSearchAccessPlan,
} = await import('@/lib/knowledge/access/predicate')
const { SYSTEM_ACCESS_SCOPE } = await import('@/lib/knowledge/access/types')

function render(condition: ReturnType<typeof knowledgeAccessCondition>) {
  return new PgDialect().sqlToQuery(condition)
}

describe('projectionCandidateAccessCondition', () => {
  const plan = {
    connectors: { workspace: ['ws-src'], admin: [], members: [], liveProofRequired: [] },
    observers: { confirmed: [], observed: [] },
    memberSources: [],
    connectorTypes: new Map(),
    uploads: true,
  }

  const pending =
    '(EXISTS (SELECT 1 FROM "knowledge_projection_dirty" WHERE "knowledge_projection_dirty"."document_id" = "embedding_search"."document_id"))'
  const onDocument =
    'AND (SELECT "document"."id" FROM "document"\n    WHERE "document"."id" = "embedding_search"."document_id"\n      AND ('

  it('decides a filled row on its mirrored columns and an unfilled or marked row on its document', () => {
    const { sql, params } = render(
      projectionCandidateAccessCondition(
        embeddingSearch,
        { kind: 'user', userId: 'user-1', tokens: ['ws', 'u:alice'] },
        plan
      )
    )
    expect(sql).toContain(`(("embedding_search"."acl" IS NULL OR ${pending}) ${onDocument}`)
    expect(sql).toContain('"document"."acl" && ARRAY[$1, $2]::text[]')
    expect(sql).toContain('OR (("embedding_search"."acl" && ARRAY[')
    expect(sql).toContain(
      'AND ("embedding_search"."connector_id" IS NULL OR "embedding_search"."connector_id" = ANY(ARRAY['
    )
    expect(sql).toContain(`AND NOT ${pending})`)
    expect(params.slice(0, 2)).toEqual(['ws', 'u:alice'])
    expect(params.slice(-3)).toEqual(['ws', 'u:alice', 'ws-src'])
    for (const param of params) expect(Array.isArray(param)).toBe(false)
  })

  it('still decides a marked row on its document once the projection is filled', () => {
    const { sql } = render(
      projectionCandidateAccessCondition(
        embeddingSearch,
        { kind: 'user', userId: 'user-1', tokens: ['ws', 'u:alice'] },
        plan,
        { filled: true }
      )
    )
    expect(sql).toContain(`((${pending} ${onDocument}`)
    expect(sql).not.toContain('"embedding_search"."acl" IS NULL')
    expect(sql).toContain(`AND NOT ${pending})`)
  })

  it('still denies everything for an empty token set', () => {
    expect(
      render(
        projectionCandidateAccessCondition(
          embeddingSearch,
          { kind: 'user', userId: 'user-1', tokens: [] },
          plan
        )
      ).sql
    ).toBe('false')
  })
})

describe('knowledgeAccessCondition', () => {
  it('overlaps the ACL with the tokens as a literal array of scalar binds', () => {
    const { sql, params } = render(
      knowledgeAccessCondition({
        kind: 'user',
        userId: 'user-1',
        tokens: ['pub', 's:confluence:-:557058:abc', 'ws'],
      })
    )
    expect(sql).toContain('"document"."acl" && ARRAY[$1, $2, $3]::text[]')
    expect(params.slice(0, 3)).toEqual(['pub', 's:confluence:-:557058:abc', 'ws'])
    for (const param of params) expect(Array.isArray(param)).toBe(false)
  })

  it('binds central Confluence evidence to scalar source, crawler, reader, subject, and site values', () => {
    const { sql, params } = render(
      knowledgeAccessCondition({
        kind: 'user',
        userId: 'user-1',
        tokens: ['s:confluence:-:alice'],
        confluenceSiteGrants: [
          {
            connectorId: 'source-1',
            contentCredentialId: 'crawler-1',
            readerCredentialId: 'reader-1',
            readerSubjectToken: 's:confluence:-:alice',
            domain: 'company.atlassian.net',
            cloudId: 'cloud-1',
          },
        ],
      })
    )
    expect(sql).toContain('confluence_read_grant')
    expect(params).toEqual(
      expect.arrayContaining(['source-1', 'crawler-1', 'reader-1', 'company.atlassian.net'])
    )
    for (const param of params) expect(Array.isArray(param)).toBe(false)
  })

  it('exempts system jobs from ACL checks while refusing removed sources', () => {
    const { sql } = render(knowledgeAccessCondition(SYSTEM_ACCESS_SCOPE))
    expect(sql).toContain('"document"."connector_id" IS NULL OR EXISTS')
    expect(sql).toContain('"knowledge_connector"."deleted_at" IS NULL')
    expect(sql).toContain('"knowledge_connector"."archived_at" IS NULL')
    expect(sql).not.toContain('"document"."acl"')
  })
})

describe('restrictSearchAccessPlan', () => {
  const plan = {
    connectors: {
      workspace: ['slack-ws'],
      admin: ['drive-admin', 'confluence-admin'],
      members: ['slack-members'],
      liveProofRequired: ['confluence-admin'],
    },
    observers: {
      confirmed: [{ id: 'm-1', connectorId: 'slack-members' }],
      observed: [{ id: 'm-2', connectorId: 'drive-admin' }],
    },
    memberSources: ['slack-members'],
    connectorTypes: new Map([
      ['slack-ws', 'slack'],
      ['slack-members', 'slack'],
      ['drive-admin', 'google_drive'],
      ['confluence-admin', 'confluence'],
    ]),
    uploads: true,
  }
  const reader = { kind: 'user' as const, userId: 'u', tokens: ['u:reader@example.com'] }

  it('drops source-less rows from both predicates once uploads are out of scope', () => {
    const rowSql = (restricted: typeof plan) =>
      render(
        projectionCandidateAccessCondition(
          {
            connectorId: sqlColumn('connector_id'),
            acl: sqlColumn('acl'),
            documentId: sqlColumn('document_id'),
          },
          reader,
          restricted
        )
      ).sql
    expect(rowSql(plan)).toContain('IS NULL OR')
    expect(rowSql(restrictSearchAccessPlan(plan, 'slack'))).not.toContain(
      '"row"."connector_id" IS NULL'
    )
    const documentSql = (restricted: typeof plan) =>
      render(knowledgeCandidateAccessConditionForConnectors(reader, restricted)).sql
    expect(documentSql(plan)).toContain('"document"."connector_id" IS NULL OR')
    expect(documentSql(restrictSearchAccessPlan(plan, 'slack'))).not.toContain(
      '"document"."connector_id" IS NULL'
    )
  })
})
