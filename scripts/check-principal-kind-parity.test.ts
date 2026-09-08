import { describe, expect, it } from 'vitest'
import { auditSource, parsePrincipalKindLiterals } from './check-principal-kind-parity'

const FILE = 'apps/sim/lib/things/application/operations.ts'

describe('principal policy parsing', () => {
  it('reads value arrays and literal tuples without reading comments', () => {
    const declarations = parsePrincipalKindLiterals(`
      interface Operation {
        readonly principalKinds: readonly ['session', 'personal_api_key', 'oauth_access_token']
      }
      const A = defineWorkspaceOperation({ principalKinds: ['session', 'delegated'] })
      // principalKinds: ['personal_api_key']
      const description = "principalKinds: ['personal_api_key']"
    `)
    expect(declarations.map((declaration) => declaration.kinds)).toEqual([
      ['session', 'personal_api_key', 'oauth_access_token'],
      ['session', 'delegated'],
    ])
  })

  it('resolves named arrays and nested spreads', () => {
    const result = auditSource(
      FILE,
      `
      const PERSONAL = ['personal_api_key'] as const
      const HUMAN = [...PERSONAL, 'oauth_access_token'] as const
      const ALL = ['session', ...HUMAN] as const
      const operation = { principalKinds: ALL }
    `
    )
    expect(result).toEqual({ findings: [], pairs: 1 })
  })

  it('resolves frozen policies while refusing arbitrary factory calls', () => {
    expect(
      auditSource(
        FILE,
        `
      const USER_KINDS = Object.freeze(['personal_api_key', 'oauth_access_token'] as const)
      const operation = { principalKinds: Object.freeze([...USER_KINDS]) }
    `
      )
    ).toEqual({ findings: [], pairs: 1 })
    expect(
      auditSource(FILE, 'const operation = { principalKinds: getKinds() }').findings
    ).toHaveLength(1)
  })

  it.each([
    ["['session', 'personal_api_key']", 'oauth_access_token'],
    ["['oauth_access_token']", 'personal_api_key'],
  ])('reports a missing paired kind in %s', (kinds, missing) => {
    const { findings } = auditSource(
      FILE,
      `const KINDS = ${kinds}; const op = { principalKinds: KINDS }`
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ file: FILE, line: 1 })
    expect(findings[0].message).toContain(`without '${missing}'`)
  })

  it('accepts an operation that names neither credential kind', () => {
    expect(auditSource(FILE, "const op = { principalKinds: ['session', 'delegated'] }")).toEqual({
      findings: [],
      pairs: 0,
    })
  })

  it.each(['EXTERNAL_KINDS', "['session', ...EXTERNAL_KINDS]"])(
    'fails closed for an unresolved policy %s',
    (kinds) => {
      const { findings } = auditSource(FILE, `const op = { principalKinds: ${kinds} }`)
      expect(findings).toHaveLength(1)
      expect(findings[0].message).toContain('Cannot resolve principalKinds')
    }
  )
})
