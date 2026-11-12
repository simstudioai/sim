/**
 * @vitest-environment node
 */
import { credential } from '@sim/db/schema'
import { queueTableRows, resetDbChainMock } from '@sim/testing/mocks/database.mock'
import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const probes = vi.hoisted(() => ({
  postgresql: vi.fn(),
  mysql: vi.fn(),
  mssql: vi.fn(),
}))
vi.mock('@/lib/core/security/encryption', () => encryptionMock)
vi.mock('@/lib/internal/postgresql/operations', () => ({
  executePostgresqlQuery: probes.postgresql,
}))
vi.mock('@/lib/internal/mysql/operations', () => ({ executeMysqlQuery: probes.mysql }))
vi.mock('@/lib/internal/mssql/operations', () => ({ executeMssqlQuery: probes.mssql }))

import {
  getDatabaseConnection,
  verifyAndEncryptDatabaseConnection,
  withSavedDatabaseConnection,
} from '@/lib/credentials/database-connections/server'

const connection = {
  host: 'db.example.com',
  port: 5432,
  database: 'app',
  username: 'app_user',
  password: ' exact password ',
  ssl: 'required',
}
const stored = { type: 'postgresql_connection_v1', connection }
const row = {
  workspaceId: 'workspace-1',
  organizationId: null,
  providerId: 'postgresql-service-account',
  type: 'service_account',
  revokedAt: null,
  encryptedServiceAccountKey: 'ciphertext',
}

function call(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'postgresql_query',
    input: {
      host: 'attacker.example.com',
      port: 1,
      database: 'other',
      username: 'other',
      password: 'inline',
      ssl: 'disabled',
      query: 'SELECT 2',
    },
    headers: new Headers(),
    context: { workflowId: 'workflow-1', workspaceId: 'workspace-1' },
    requestId: 'request-1',
    ...overrides,
  }
}

describe('saved database connections', () => {
  beforeEach(() => {
    resetDbChainMock()
    for (const probe of Object.values(probes)) {
      probe.mockReset()
      probe.mockResolvedValue({ rows: [{ sim_connection_ok: 1 }], rowCount: 1 })
    }
    encryptionMockFns.mockEncryptSecret.mockResolvedValue({ encrypted: 'ciphertext', iv: 'iv' })
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: JSON.stringify(stored) })
  })

  describe('saving', () => {
    it('proves the exact login with SELECT 1 before encrypting it', async () => {
      const result = await verifyAndEncryptDatabaseConnection(
        'postgresql-service-account',
        JSON.stringify(connection)
      )

      expect(result).toEqual({
        encryptedServiceAccountKey: 'ciphertext',
        username: 'app_user',
        displayName: 'app_user@db.example.com/app',
      })
      expect(probes.postgresql.mock.calls[0]?.[0]).toEqual({
        ...connection,
        query: 'SELECT 1 AS sim_connection_ok',
      })
      expect(probes.postgresql.mock.invocationCallOrder[0]).toBeLessThan(
        encryptionMockFns.mockEncryptSecret.mock.invocationCallOrder[0]
      )
      expect(JSON.parse(encryptionMockFns.mockEncryptSecret.mock.calls[0]?.[0])).toEqual(stored)
    })

    it('stores the transport-security defaults explicitly so later runs never infer them', async () => {
      const { ssl: _ssl, ...withoutTls } = connection
      await verifyAndEncryptDatabaseConnection('mysql-service-account', JSON.stringify(withoutTls))
      await verifyAndEncryptDatabaseConnection(
        'mssql-service-account',
        JSON.stringify({ ...withoutTls, port: 1433 })
      )

      const [mysql, mssql] = encryptionMockFns.mockEncryptSecret.mock.calls.map(([blob]) =>
        JSON.parse(blob)
      )
      expect(mysql).toEqual({
        type: 'mysql_connection_v1',
        connection: { ...withoutTls, ssl: 'preferred' },
      })
      expect(mssql).toEqual({
        type: 'mssql_connection_v1',
        connection: {
          ...withoutTls,
          port: 1433,
          encrypt: 'enabled',
          trustServerCertificate: 'disabled',
        },
      })
      expect(probes.mssql.mock.calls[0]?.[0]).toMatchObject({ connectionTimeout: 15_000 })
    })

    it.each([
      ['malformed JSON', '{'],
      ['an unknown connection field', JSON.stringify({ ...connection, sslrootcert: '...' })],
      ['a port outside the TCP range', JSON.stringify({ ...connection, port: 70_000 })],
      ['a missing password', JSON.stringify({ ...connection, password: '' })],
      ['an SSL mode the tools do not support', JSON.stringify({ ...connection, ssl: 'allow' })],
      ['a body over 64 KiB', `${JSON.stringify(connection)}${' '.repeat(70_000)}`],
    ])('refuses %s without connecting or storing', async (_case, serialized) => {
      await expect(
        verifyAndEncryptDatabaseConnection('postgresql-service-account', serialized)
      ).rejects.toThrow(/PostgreSQL connection/)
      expect(probes.postgresql).not.toHaveBeenCalled()
      expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
    })

    it('keeps a driver error, which can echo the login, out of the message and storage', async () => {
      probes.postgresql.mockRejectedValue(new Error('auth failed for " exact password "'))

      const error = await verifyAndEncryptDatabaseConnection(
        'postgresql-service-account',
        JSON.stringify(connection)
      ).catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe('Could not verify the PostgreSQL connection')
      expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
    })

    it('refuses a server that does not answer SELECT 1 with 1', async () => {
      probes.postgresql.mockResolvedValue({ rows: [{ sim_connection_ok: 0 }], rowCount: 1 })

      await expect(
        verifyAndEncryptDatabaseConnection('postgresql-service-account', JSON.stringify(connection))
      ).rejects.toThrow('Could not verify the PostgreSQL connection')
      expect(encryptionMockFns.mockEncryptSecret).not.toHaveBeenCalled()
    })
  })

  describe('loading', () => {
    it('returns the stored connection for its own provider and owner', async () => {
      queueTableRows(credential, [row])

      await expect(
        getDatabaseConnection('postgresql-service-account', 'credential-1', {
          workspaceId: 'workspace-1',
        })
      ).resolves.toEqual(connection)
    })

    it.each([
      ['another engine', { providerId: 'mysql-service-account' }],
      ['another workspace', { workspaceId: 'workspace-2' }],
      ['a revoked credential', { revokedAt: new Date() }],
      ['an organization credential', { organizationId: 'organization-1' }],
    ])('refuses %s before decrypting', async (_case, override) => {
      queueTableRows(credential, [{ ...row, ...override }])

      await expect(
        getDatabaseConnection('postgresql-service-account', 'credential-1', {
          workspaceId: 'workspace-1',
        })
      ).rejects.toThrow('PostgreSQL connection is unavailable')
      expect(encryptionMockFns.mockDecryptSecret).not.toHaveBeenCalled()
    })

    it.each([
      ['another engine’s blob', { ...stored, type: 'mysql_connection_v1' }],
      ['an unknown stored field', { ...stored, connection: { ...connection, extra: 'x' } }],
    ])('refuses %s', async (_case, blob) => {
      queueTableRows(credential, [row])
      encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: JSON.stringify(blob) })

      await expect(
        getDatabaseConnection('postgresql-service-account', 'credential-1', {
          workspaceId: 'workspace-1',
        })
      ).rejects.toThrow('PostgreSQL connection is unavailable')
    })
  })

  describe('running a tool', () => {
    const handler = vi.fn(async (request: InternalToolOperationCall) =>
      Response.json(request.input)
    )

    it('hands an inline-connection call to the handler untouched', async () => {
      const request = call()

      await withSavedDatabaseConnection('postgresql-service-account', handler)(request)

      expect(handler.mock.calls[0]?.[0]).toBe(request)
    })

    it('ignores a credential the executor authorized for another service', async () => {
      const request = call({
        context: {
          workflowId: 'workflow-1',
          workspaceId: 'workspace-1',
          authorizedServiceAccountCredential: { credentialId: 'credential-1', service: 'mysql' },
        },
      })

      await withSavedDatabaseConnection('postgresql-service-account', handler)(request)

      expect(handler.mock.calls[0]?.[0]).toBe(request)
    })

    it('replaces every connection field with the saved connection and keeps the rest', async () => {
      queueTableRows(credential, [row])

      const response = await withSavedDatabaseConnection(
        'postgresql-service-account',
        handler
      )(
        call({
          context: {
            workflowId: 'workflow-1',
            workspaceId: 'workspace-1',
            authorizedServiceAccountCredential: {
              credentialId: 'credential-1',
              service: 'postgresql',
            },
          },
        })
      )

      expect(await response.json()).toEqual({ ...connection, query: 'SELECT 2' })
    })

    it('refuses with 403 and never runs when the saved connection is unavailable', async () => {
      queueTableRows(credential, [{ ...row, workspaceId: 'workspace-2' }])

      const response = await withSavedDatabaseConnection(
        'postgresql-service-account',
        handler
      )(
        call({
          context: {
            workflowId: 'workflow-1',
            workspaceId: 'workspace-1',
            authorizedServiceAccountCredential: {
              credentialId: 'credential-1',
              service: 'postgresql',
            },
          },
        })
      )

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: 'PostgreSQL connection is unavailable' })
      expect(handler).not.toHaveBeenCalled()
    })

    it('stops when the run is aborted while the connection loads', async () => {
      const controller = new AbortController()
      queueTableRows(credential, [row])
      encryptionMockFns.mockDecryptSecret.mockImplementation(async () => {
        controller.abort(new Error('run cancelled'))
        return { decrypted: JSON.stringify(stored) }
      })

      await expect(
        withSavedDatabaseConnection(
          'postgresql-service-account',
          handler
        )(
          call({
            signal: controller.signal,
            context: {
              workflowId: 'workflow-1',
              workspaceId: 'workspace-1',
              authorizedServiceAccountCredential: {
                credentialId: 'credential-1',
                service: 'postgresql',
              },
            },
          })
        )
      ).rejects.toThrow('run cancelled')
      expect(handler).not.toHaveBeenCalled()
    })
  })
})
