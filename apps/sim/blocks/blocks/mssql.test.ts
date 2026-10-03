import { describe, expect, it } from 'vitest'
import { MSSQLBlock } from '@/blocks/blocks/mssql'
import * as mssqlTools from '@/tools/mssql'

/**
 * Every assertion here runs against `{ ...inputs, ...buildParams(inputs) }`, the
 * shape the generic tool handler actually forwards. A key the mapper omits is
 * *not* dropped by that merge — the raw subBlock value survives — so asserting
 * on the mapper's return alone would prove nothing about what the tool receives.
 */
describe('MSSQLBlock', () => {
  const buildParams = MSSQLBlock.tools.config.params!

  const connection = {
    host: 'db.example.com',
    port: '1433',
    database: 'app',
    username: 'app',
    password: 'secret',
  }

  /**
   * The TLS toggles are string enums rather than switches on purpose: a switch
   * subBlock serializes the *string* `'false'`, which is truthy, and the route
   * contract would then coerce the user's "off" into `true`. These assertions
   * pin the string all the way through the merge.
   */
  it('carries the TLS toggles through as strings, never as booleans', () => {
    const inputs = {
      ...connection,
      operation: 'query',
      query: 'SELECT 1',
      encrypt: 'disabled',
      trustServerCertificate: 'disabled',
    }
    const finalInputs = { ...inputs, ...buildParams(inputs) }

    expect(finalInputs.encrypt).toBe('disabled')
    expect(finalInputs.trustServerCertificate).toBe('disabled')
  })

  it('defaults the TLS toggles to the secure pair when the subBlocks are untouched', () => {
    const inputs = { ...connection, operation: 'query', query: 'SELECT 1' }
    const finalInputs = { ...inputs, ...buildParams(inputs) }

    expect(finalInputs.encrypt).toBe('enabled')
    expect(finalInputs.trustServerCertificate).toBe('disabled')
  })

  it('surfaces a malformed data payload as a named error rather than forwarding the string', () => {
    expect(() =>
      buildParams({ ...connection, operation: 'insert', table: 'users', data: '{not json' })
    ).toThrow(/Invalid JSON data format/)
  })

  /**
   * The mapper leaves `connectionTimeout` unassigned when it is blank, but the
   * merge means the empty subBlock string reaches the tool regardless — so the
   * omission is not what makes this safe. The tool's own `params.connectionTimeout ? …`
   * guard is, and the route contract then applies its 15000 ms default.
   */
  it('lets a blank connectionTimeout through the merge as the raw empty string', () => {
    const inputs = { ...connection, operation: 'query', query: 'SELECT 1', connectionTimeout: '' }
    const finalInputs = { ...inputs, ...buildParams(inputs) }

    expect(finalInputs.connectionTimeout).toBe('')
  })
})

describe('Microsoft SQL Server tool declarations', () => {
  it('never lets an LLM choose which database to open', () => {
    // Every other connection field, on every other tool, is user-only. A model
    // picking the database means the user's credentials open something else.
    for (const tool of Object.values(mssqlTools)) {
      for (const field of ['host', 'port', 'database', 'username', 'password']) {
        const param = tool.params[field]
        if (!param) continue
        expect(param.visibility, `${tool.id}.${field}`).toBe('user-only')
      }
    }
  })
})
