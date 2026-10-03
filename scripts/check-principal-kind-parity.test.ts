import { describe, expect, it } from 'vitest'
import { auditSource } from './check-principal-kind-parity'

const FILE = 'apps/sim/lib/things/application/operations.ts'

describe('principal policy parsing', () => {
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

  it.each(['EXTERNAL_KINDS', "['session', ...EXTERNAL_KINDS]"])(
    'fails closed for an unresolved policy %s',
    (kinds) => {
      const { findings } = auditSource(FILE, `const op = { principalKinds: ${kinds} }`)
      expect(findings).toHaveLength(1)
      expect(findings[0].message).toContain('Cannot resolve principalKinds')
    }
  )
})
