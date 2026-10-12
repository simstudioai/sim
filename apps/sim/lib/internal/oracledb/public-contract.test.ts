/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { OracleDatabaseBlock } from '@/blocks/blocks/oracledb'
import { oracleQueryTool } from '@/tools/oracledb'

// Runtime projection must never let caller-supplied connection secrets replace the saved credential.
describe('Oracle Database public integration boundary', () => {
  it('forwards only the executor-authorized credential reference and parses runtime values', () => {
    const params = OracleDatabaseBlock.tools.config.params?.({
      oauthCredential: 'selected',
      connectionTimeout: '30000',
      binds: '{"id":42}',
      query: 'SELECT :id FROM DUAL',
    })
    expect(params).toMatchObject({
      oauthCredential: 'selected',
      connectionTimeout: 30000,
      binds: { id: 42 },
    })
    const input = oracleQueryTool.operation.input({
      ...params,
      oauthCredential: 'selected',
      accessToken: 'authorized',
      credentialId: 'forged',
      host: 'attacker.example',
      password: 'plaintext',
      query: 'SELECT :id FROM DUAL',
    })
    expect(input).toEqual({
      credentialId: 'authorized',
      connectionTimeout: 30000,
      binds: { id: 42 },
      query: 'SELECT :id FROM DUAL',
    })
    expect(
      oracleQueryTool.operation.input({ oauthCredential: 'untrusted', query: 'SELECT 1 FROM DUAL' })
    ).toMatchObject({ credentialId: '' })
  })
})
