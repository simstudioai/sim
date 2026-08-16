/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { MSSQLBlock } from '@/blocks/blocks/mssql'

/**
 * Every assertion here runs against `{ ...inputs, ...buildParams(inputs) }`, the
 * shape the generic tool handler actually forwards. A key the mapper omits is
 * *not* dropped by that merge — the raw subBlock value survives — so asserting
 * on the mapper's return alone would prove nothing about what the tool receives.
 */
describe('MSSQLBlock', () => {
  const buildParams = MSSQLBlock.tools.config.params!
  const selectTool = MSSQLBlock.tools.config.tool!

  const connection = {
    host: 'db.example.com',
    port: '1433',
    database: 'app',
    username: 'app',
    password: 'secret',
  }

  it('maps every dropdown operation onto a registered tool', () => {
    const operation = MSSQLBlock.subBlocks.find((subBlock) => subBlock.id === 'operation')
    const optionIds = operation?.options?.map((option) => option.id) ?? []

    expect(optionIds).toHaveLength(6)
    expect(new Set(optionIds.map((id) => selectTool({ operation: id })))).toEqual(
      new Set(MSSQLBlock.tools.access)
    )
  })

  it('rejects an operation outside the registered tool set', () => {
    expect(() => selectTool({ operation: 'mssql_truncate' })).toThrow(
      /Invalid Microsoft SQL Server operation/
    )
  })

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

  it('parses the port and a JSON data payload into their runtime types', () => {
    const inputs = {
      ...connection,
      port: '14330',
      operation: 'insert',
      table: 'users',
      data: '{"name":"Jane","age":30}',
    }
    const finalInputs = { ...inputs, ...buildParams(inputs) }

    expect(finalInputs.port).toBe(14330)
    expect(finalInputs.data).toEqual({ name: 'Jane', age: 30 })
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

  it('parses connectionTimeout when it is set', () => {
    const inputs = {
      ...connection,
      operation: 'query',
      query: 'SELECT 1',
      connectionTimeout: '30000',
    }
    const finalInputs = { ...inputs, ...buildParams(inputs) }

    expect(finalInputs.connectionTimeout).toBe(30000)
  })

  it('does not offer a named-instance field, which cannot stay pinned to the validated IP', () => {
    const ids = MSSQLBlock.subBlocks.map((subBlock) => subBlock.id)

    expect(ids).not.toContain('instanceName')
  })

  /**
   * Duplicate subBlock ids across disjoint operations are the house pattern, but
   * the store seeds values by id in file order — so two entries sharing an id
   * must agree on their default, or the last one silently wins.
   */
  it('keeps duplicate subBlock ids in agreement on their default value', () => {
    const defaultsById = new Map<string, unknown[]>()
    for (const subBlock of MSSQLBlock.subBlocks) {
      const seeded = typeof subBlock.value === 'function' ? subBlock.value({}) : undefined
      defaultsById.set(subBlock.id, [...(defaultsById.get(subBlock.id) ?? []), seeded])
    }

    for (const [id, defaults] of defaultsById) {
      expect(
        new Set(defaults.map((value) => JSON.stringify(value))),
        `subBlock "${id}"`
      ).toHaveLength(1)
    }
  })
})
