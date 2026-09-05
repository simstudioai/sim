import { describe, expect, it } from 'vitest'
import { auditSource, parsePrincipalKindLiterals } from './check-principal-kind-parity'

const FILE = 'apps/sim/lib/things/application/operations.ts'

describe('principalKinds literal parsing', () => {
  it('reads single-line and multi-line literals, including type-level ones', () => {
    const literals = parsePrincipalKindLiterals(`
      readonly principalKinds: readonly ['session', 'personal_api_key', 'oauth_access_token']
      const A = defineWorkspaceOperation({
        principalKinds: [
          'session',
          'delegated',
        ],
      })
      principalKinds?: readonly ['session']
    `)

    expect(literals.map((literal) => literal.kinds)).toEqual([
      ['session', 'personal_api_key', 'oauth_access_token'],
      ['session', 'delegated'],
      ['session'],
    ])
  })
})

describe('assertion A — the two user-credential kinds travel together', () => {
  it('accepts a policy that names both, and one that names neither', () => {
    const { findings, pairs } = auditSource(
      FILE,
      `
        principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
        principalKinds: ['session', 'delegated'],
      `
    )

    expect(findings).toEqual([])
    expect(pairs).toBe(1)
  })

  it('reports a policy that admits the key but not the token', () => {
    const { findings } = auditSource(FILE, "principalKinds: ['session', 'personal_api_key'],")

    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ file: FILE, line: 1 })
    expect(findings[0].message).toContain("without 'oauth_access_token'")
  })

  it('reports a policy that admits the token but not the key', () => {
    const { findings } = auditSource(FILE, "principalKinds: ['oauth_access_token'],")

    expect(findings).toHaveLength(1)
    expect(findings[0].message).toContain("without 'personal_api_key'")
  })

  it('does not count a spread constant as naming a bare kind', () => {
    const { findings, pairs } = auditSource(
      FILE,
      "principalKinds: ['session', ...USER_CREDENTIAL_PRINCIPAL_KINDS],"
    )

    expect(findings).toEqual([])
    expect(pairs).toBe(0)
  })
})
