import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { flattenDiagnostic } from '../diagnostics'
import { type SecretsDecl, secretCodec } from './secrets'

const description = fc
  .string({ maxLength: 40 })
  .filter((value) => !/[\u0000\ud800-\udfff]/.test(value))
const secrets: fc.Arbitrary<SecretsDecl> = fc.dictionary(
  fc.stringMatching(/^[A-Za-z0-9_]{1,20}$/).filter((name) => name !== '__proto__'),
  fc.record({ description }, { requiredKeys: [] })
)

function parse(source: string) {
  return secretCodec.parse('secrets', { 'secrets.ts': source }, [])
}

describe('secrets.ts', () => {
  it('reads back every declaration it prints', () => {
    fc.assert(
      fc.property(secrets, (decl) => {
        const printed = secretCodec.print('secrets', decl).text['secrets.ts']
        const read = parse(printed)

        expect(read.diagnostics).toEqual([])
        expect(read.decl).toEqual(decl)
      })
    )
  })

  it('refuses a value without echoing it in any finding', () => {
    const value = 'sk-live-0123456789abcdef'
    const read = parse(`// @sim-sdk 1
import { defineSecrets } from '@sim/workflow-sdk/workspace'

export default defineSecrets({ OPENAI_API_KEY: { value: '${value}' } })
`)

    expect(read.decl).toBeUndefined()
    expect(read.diagnostics.map((finding) => finding.code)).toEqual(['E_DECL_UNKNOWN_FIELD'])
    expect(JSON.stringify(read.diagnostics.map(flattenDiagnostic))).not.toContain(value)
  })

  it('refuses a name a secret cannot have', () => {
    const read = parse(`// @sim-sdk 1
import { defineSecrets } from '@sim/workflow-sdk/workspace'

export default defineSecrets({ 'OPENAI-KEY': {} })
`)

    expect(read.diagnostics.map((finding) => finding.code)).toEqual(['E_SECRET_NAME'])
  })
})
