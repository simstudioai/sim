import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { flattenDiagnostic } from '../diagnostics'
import { type CredentialsDecl, credentialCodec } from './credentials'

const text = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((value) => !/[\u0000\ud800-\udfff]/.test(value))
const credentials: fc.Arbitrary<CredentialsDecl> = fc.dictionary(
  fc.stringMatching(/^[a-z][a-z0-9_-]{0,20}$/),
  fc.record({ provider: text, name: text }, { requiredKeys: ['provider'] })
)

function parse(source: string) {
  return credentialCodec.parse('credentials', { 'credentials.ts': source }, [])
}

describe('credentials.ts', () => {
  it('reads back every declaration it prints', () => {
    fc.assert(
      fc.property(credentials, (decl) => {
        const printed = credentialCodec.print('credentials', decl).text['credentials.ts']
        const read = parse(printed)

        expect(read.diagnostics).toEqual([])
        expect(read.decl).toEqual(decl)
      })
    )
  })

  it('refuses a token without echoing it in any finding', () => {
    const token = ['xoxb', '0123456789', 'abcdef'].join('-')
    const read = parse(`// @sim-sdk 1
import { defineCredentials } from '@sim/workflow-sdk/workspace'

export default defineCredentials({ slack: { provider: 'slack', token: '${token}' } })
`)

    expect(read.decl).toBeUndefined()
    expect(read.diagnostics.map((finding) => finding.code)).toEqual(['E_DECL_UNKNOWN_FIELD'])
    expect(JSON.stringify(read.diagnostics.map(flattenDiagnostic))).not.toContain(token)
  })

  it('refuses a key without a provider, and a key a workflow cannot name', () => {
    const read = parse(`// @sim-sdk 1
import { defineCredentials } from '@sim/workflow-sdk/workspace'

export default defineCredentials({ slack: {}, Gmail: { provider: 'google-email' } })
`)

    expect(read.diagnostics.map((finding) => finding.code).sort()).toEqual([
      'E_DECL_SHAPE',
      'E_KEY_INVALID',
    ])
  })
})
