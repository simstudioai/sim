/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { OracleDatabaseBlock } from '@/blocks/blocks/oracledb'
import {
  oracleDeleteTool,
  oracleExecuteTool,
  oracleInsertTool,
  oracleIntrospectTool,
  oracleQueryTool,
  oracleUpdateTool,
} from '@/tools/oracledb'
import type { OracleQueryParams } from '@/tools/oracledb/types'

const CONNECTION_FIELDS = [
  'host',
  'port',
  'protocol',
  'connectionType',
  'serviceName',
  'sid',
  'username',
  'password',
  'connectionTimeout',
  'walletContent',
  'walletPassword',
] as const

const toolsByOperation = {
  query: oracleQueryTool,
  insert: oracleInsertTool,
  update: oracleUpdateTool,
  delete: oracleDeleteTool,
  execute: oracleExecuteTool,
  introspect: oracleIntrospectTool,
} as const

const operationFields = {
  query: ['query', 'binds'],
  insert: ['schema', 'table', 'data'],
  update: ['schema', 'table', 'data', 'where'],
  delete: ['schema', 'table', 'where'],
  execute: ['query', 'binds'],
  introspect: ['schema'],
} as const

describe('Oracle Database public integration contract', () => {
  const buildParams = OracleDatabaseBlock.tools.config.params!
  const selectTool = OracleDatabaseBlock.tools.config.tool!

  const connection = {
    host: 'db.example.com',
    username: 'application',
    password: 'secret',
  }

  it('maps every block operation to its exact registered tool id', () => {
    const operation = OracleDatabaseBlock.subBlocks.find((subBlock) => subBlock.id === 'operation')
    const optionIds = operation?.options?.map((option) => option.id) ?? []

    expect(optionIds).toEqual(['query', 'insert', 'update', 'delete', 'execute', 'introspect'])
    expect(
      Object.fromEntries(
        optionIds.map((operationId) => [operationId, selectTool({ operation: operationId })])
      )
    ).toEqual({
      query: 'oracledb_query',
      insert: 'oracledb_insert',
      update: 'oracledb_update',
      delete: 'oracledb_delete',
      execute: 'oracledb_execute',
      introspect: 'oracledb_introspect',
    })
    expect(OracleDatabaseBlock.tools.access).toEqual([
      'oracledb_query',
      'oracledb_insert',
      'oracledb_update',
      'oracledb_delete',
      'oracledb_execute',
      'oracledb_introspect',
    ])
  })

  it('applies connection defaults and parses numeric and JSON inputs', () => {
    const defaults = buildParams({
      ...connection,
      operation: 'query',
      serviceName: 'FREEPDB1',
      query: 'SELECT :customer_id FROM DUAL',
      binds: '{"customer_id":42,"status":"ACTIVE"}',
    })
    const explicit = buildParams({
      ...connection,
      operation: 'insert',
      port: '1522',
      connectionTimeout: '30000',
      serviceName: 'FREEPDB1',
      table: 'CUSTOMERS',
      data: '{"CUSTOMER_ID":42,"NAME":"Ada"}',
    })

    expect(defaults).toMatchObject({
      port: 1521,
      protocol: 'tcp',
      connectionType: 'serviceName',
      serviceName: 'FREEPDB1',
      connectionTimeout: 15000,
      binds: { customer_id: 42, status: 'ACTIVE' },
    })
    expect(defaults.sid).toBeUndefined()
    expect(explicit).toMatchObject({
      port: 1522,
      connectionTimeout: 30000,
      data: { CUSTOMER_ID: 42, NAME: 'Ada' },
    })
  })

  it('accepts the defaulted connection fields as optional in the exported contract', () => {
    const minimal = {
      host: 'db.example.com',
      serviceName: 'FREEPDB1',
      username: 'application',
      password: 'secret',
      query: 'SELECT 1 FROM DUAL',
    } satisfies OracleQueryParams

    expect(oracleQueryTool.operation.input(minimal)).toMatchObject({
      port: 1521,
      protocol: 'tcp',
      connectionType: 'serviceName',
      connectionTimeout: 15000,
    })
  })

  it('selects exactly one service identifier and only forwards wallets for TCPS', () => {
    const service = buildParams({
      ...connection,
      operation: 'query',
      connectionType: 'serviceName',
      serviceName: 'FREEPDB1',
      sid: 'IGNORED',
      query: 'SELECT 1 FROM DUAL',
      walletContent: 'IGNORED OVER TCP',
      walletPassword: 'IGNORED OVER TCP',
    })
    const sid = buildParams({
      ...connection,
      operation: 'query',
      protocol: 'tcps',
      connectionType: 'sid',
      serviceName: 'IGNORED',
      sid: 'ORCL',
      query: 'SELECT 1 FROM DUAL',
      walletContent: '-----BEGIN PRIVATE KEY-----',
      walletPassword: 'wallet-secret',
    })

    expect(service).toMatchObject({ serviceName: 'FREEPDB1' })
    expect(service.sid).toBeUndefined()
    expect(service.walletContent).toBeUndefined()
    expect(service.walletPassword).toBeUndefined()
    expect(sid).toMatchObject({
      protocol: 'tcps',
      connectionType: 'sid',
      sid: 'ORCL',
      walletContent: '-----BEGIN PRIVATE KEY-----',
      walletPassword: 'wallet-secret',
    })
    expect(sid.serviceName).toBeUndefined()
  })

  it('pins all six exact tool ids, versions, parameter sets, and visibility boundaries', () => {
    for (const [operation, tool] of Object.entries(toolsByOperation)) {
      const expectedOperationFields = operationFields[operation as keyof typeof operationFields]

      expect(tool.id).toBe(`oracledb_${operation}`)
      expect(tool.version).toBe('1.0.0')
      expect(Object.keys(tool.params).sort()).toEqual(
        [...CONNECTION_FIELDS, ...expectedOperationFields].sort()
      )

      for (const field of CONNECTION_FIELDS) {
        expect(tool.params[field]?.visibility, `${tool.id}.${field}`).toBe('user-only')
      }
      for (const field of expectedOperationFields) {
        expect(tool.params[field]?.visibility, `${tool.id}.${field}`).toBe('user-or-llm')
      }
    }
  })
})
