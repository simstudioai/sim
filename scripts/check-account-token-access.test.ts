import { describe, expect, it } from 'vitest'
import { auditSource } from './check-account-token-access'

const FILE = 'apps/sim/lib/webhooks/providers/example.ts'

describe('auditSource', () => {
  it('flags a direct token-column read', () => {
    const findings = auditSource(
      FILE,
      `const token = row.accessToken\nconst x = account.accessToken`
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ line: 2, kind: 'token-column' })
  })

  it.each(['accessToken', 'refreshToken', 'idToken'])('flags account.%s', (field) => {
    expect(auditSource(FILE, `select({ v: account.${field} })`)).toHaveLength(1)
  })

  it('flags the schema-qualified form Better Auth hooks use', () => {
    expect(auditSource(FILE, 'const t = schema.account.refreshToken')).toHaveLength(1)
  })

  /** The implicit case: no token column is named, but all three come back. */
  it('flags a projection-less select', () => {
    const findings = auditSource(
      FILE,
      'const rows = await db.select().from(account).where(eq(account.userId, userId))'
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('star-select')
  })

  it('flags the relational read', () => {
    const findings = auditSource(FILE, 'const row = await db.query.account.findFirst({ where })')
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('relational-read')
  })

  /** The shape a new connect flow gets copied into; no read-side rule would catch it. */
  it.each([
    ['insert', 'await db.insert(account).values({ accessToken: raw })'],
    ['update', 'await db.update(account).set({ accessToken: raw }).where(eq(account.id, id))'],
    ['schema-qualified update', 'await db.update(schema.account).set({ scope })'],
    ['chained update', '  .update(account)'],
  ])('flags a direct %s of the account table', (_label, src) => {
    const findings = auditSource(FILE, src)
    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('write')
  })

  /**
   * The formatter breaks any chain past the print width, so this is how these calls are
   * actually written. A per-line scan saw none of them.
   */
  it.each([
    ['select', 'const rows = await db\n  .select()\n  .from(account)\n  .where(x)'],
    ['update', 'await db\n  .update(account)\n  .set({ accessToken: raw })'],
    [
      'insert with a wrapped argument',
      'await db.insert(\n  account\n).values({ accessToken: raw })',
    ],
    ['relational read', 'const row = await db\n  .query\n  .account\n  .findFirst({ where })'],
  ])('flags a multiline %s', (_label, src) => {
    expect(auditSource(FILE, src)).toHaveLength(1)
  })

  it('still allows a narrowed projection when it spans lines', () => {
    expect(
      auditSource(FILE, 'const rows = await db\n  .select({ id: account.id })\n  .from(account)')
    ).toEqual([])
  })

  it('does not flag a write to a different table', () => {
    expect(auditSource(FILE, 'await db.update(credential).set({ scope })')).toEqual([])
  })

  it('allows a narrowed projection', () => {
    expect(
      auditSource(FILE, 'await db.select({ id: account.id, userId: account.userId }).from(account)')
    ).toEqual([])
  })

  it('does not confuse a same-named field on another object', () => {
    expect(auditSource(FILE, 'const t = tokens.accessToken\nconst u = chain.refreshToken')).toEqual(
      []
    )
  })

  it('exempts the token-aware modules', () => {
    const source = 'await db.select().from(account)\nconst t = account.accessToken'
    expect(auditSource('apps/sim/lib/oauth/account-tokens.ts', source)).toEqual([])
    expect(auditSource('apps/sim/lib/oauth/credential-service.ts', source)).toEqual([])
    expect(auditSource('apps/sim/lib/oauth/slack.ts', source)).toEqual([])
  })

  describe('annotation', () => {
    it('suppresses a finding when it carries a reason', () => {
      expect(
        auditSource(
          FILE,
          '// account-token-access-allow: decrypted immediately below\nconst t = account.idToken'
        )
      ).toEqual([])
    })

    it('reports an annotation with no reason rather than honoring it', () => {
      const findings = auditSource(
        FILE,
        '// account-token-access-allow:\nconst t = account.idToken'
      )
      expect(findings).toHaveLength(1)
      expect(findings[0].kind).toBe('empty-reason')
    })

    it('reaches across intervening comment lines', () => {
      expect(
        auditSource(
          FILE,
          '// account-token-access-allow: needed for display name\n// more context\nconst t = account.idToken'
        )
      ).toEqual([])
    })

    /** An annotation must not leak past unrelated code onto a later violation. */
    it('does not carry past a line of code', () => {
      expect(
        auditSource(
          FILE,
          '// account-token-access-allow: covers the next line only\nconst a = account.idToken\nconst b = account.accessToken'
        )
      ).toHaveLength(1)
    })

    it('does not reach further than three lines back', () => {
      expect(
        auditSource(
          FILE,
          '// account-token-access-allow: too far\n//\n//\n//\nconst t = account.idToken'
        )
      ).toHaveLength(1)
    })
  })
})
