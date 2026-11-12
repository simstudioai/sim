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

import type { DatabaseConnectionProviderId } from '@/lib/credentials/database-connections/descriptors'
import {
  verifyAndEncryptDatabaseConnection,
  withSavedDatabaseConnection,
} from '@/lib/credentials/database-connections/server'
import {
  MSSQL_CREDENTIAL_OAUTH,
  MYSQL_CREDENTIAL_OAUTH,
  POSTGRESQL_CREDENTIAL_OAUTH,
} from '@/tools/shared/saved-credentials'

const connection = {
  host: 'db.example.com',
  port: 5432,
  database: 'app',
  username: 'app_user',
  password: ' exact password ',
  ssl: 'required',
}
const stored = { type: 'postgresql_connection_v1', connection }
const { ssl: _ssl, ...connectionWithoutTls } = connection
const row = {
  workspaceId: 'workspace-1',
  organizationId: null,
  providerId: 'postgresql-service-account',
  type: 'service_account',
  revokedAt: null,
  encryptedServiceAccountKey: 'ciphertext',
}

const savedConnectionContext = {
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
  authorizedServiceAccountCredential: { credentialId: 'credential-1', service: 'postgresql' },
}

const inlineInput = {
  host: 'attacker.example.com',
  port: 1,
  database: 'other',
  username: 'other',
  password: 'inline',
  ssl: 'disabled',
  query: 'SELECT 2',
}
const { ssl: _inlineSsl, ...inlineInputWithoutTls } = inlineInput

function call(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'postgresql_query',
    input: inlineInput,
    headers: new Headers(),
    context: { workflowId: 'workflow-1', workspaceId: 'workspace-1' },
    requestId: 'request-1',
    ...overrides,
  }
}

const echo = vi.fn(async (request: InternalToolOperationCall) => Response.json(request.input))

describe('saved database connections', () => {
  beforeEach(() => {
    echo.mockClear()
    resetDbChainMock()
    for (const probe of Object.values(probes)) {
      probe.mockReset()
      probe.mockResolvedValue({ rows: [{ sim_connection_ok: 1 }], rowCount: 1 })
    }
    encryptionMockFns.mockEncryptSecret.mockResolvedValue({ encrypted: 'ciphertext', iv: 'iv' })
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: JSON.stringify(stored) })
  })

  describe('saving', () => {
    it.each([
      {
        providerId: 'postgresql-service-account',
        service: 'postgresql',
        probe: probes.postgresql,
        login: connectionWithoutTls,
        defaults: { ssl: 'preferred' },
        probeOnly: {},
      },
      {
        providerId: 'mysql-service-account',
        service: 'mysql',
        probe: probes.mysql,
        login: connectionWithoutTls,
        defaults: { ssl: 'preferred' },
        probeOnly: {},
      },
      {
        providerId: 'mssql-service-account',
        service: 'mssql',
        probe: probes.mssql,
        login: { ...connectionWithoutTls, port: 1433 },
        defaults: { encrypt: 'enabled', trustServerCertificate: 'disabled' },
        probeOnly: { connectionTimeout: 15_000 },
      },
    ] as const)(
      'proves the exact $service login and a later run reads it back with its TLS defaults',
      async ({ providerId, service, probe, login, defaults, probeOnly }) => {
        encryptionMockFns.mockEncryptSecret.mockImplementation(async (plain: string) => ({
          encrypted: plain,
          iv: 'iv',
        }))
        encryptionMockFns.mockDecryptSecret.mockImplementation(async (encrypted: string) => ({
          decrypted: encrypted,
        }))

        const saved = await verifyAndEncryptDatabaseConnection(
          providerId satisfies DatabaseConnectionProviderId,
          JSON.stringify(login)
        )
        expect(probe.mock.calls[0]?.[0]).toEqual({
          ...login,
          ...defaults,
          ...probeOnly,
          query: 'SELECT 1 AS sim_connection_ok',
        })
        expect(saved).toMatchObject({
          username: 'app_user',
          displayName: `app_user@db.example.com/app`,
        })

        queueTableRows(credential, [
          { ...row, providerId, encryptedServiceAccountKey: saved.encryptedServiceAccountKey },
        ])
        const response = await withSavedDatabaseConnection(
          providerId,
          echo
        )(
          call({
            context: {
              ...savedConnectionContext,
              authorizedServiceAccountCredential: { credentialId: 'credential-1', service },
            },
          })
        )

        expect(await response.json()).toEqual({ ...inlineInput, ...login, ...defaults })
      }
    )

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

  describe('running a tool', () => {
    const handler = echo

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
          context: savedConnectionContext,
        })
      )

      expect(await response.json()).toEqual({ ...connection, query: 'SELECT 2' })
    })

    it.each([
      {
        providerId: 'postgresql-service-account',
        oauth: POSTGRESQL_CREDENTIAL_OAUTH,
        saved: connection,
        input: inlineInput,
      },
      {
        providerId: 'mysql-service-account',
        oauth: MYSQL_CREDENTIAL_OAUTH,
        saved: connection,
        input: inlineInput,
      },
      {
        providerId: 'mssql-service-account',
        oauth: MSSQL_CREDENTIAL_OAUTH,
        saved: connectionWithoutTls,
        input: {
          ...inlineInputWithoutTls,
          encrypt: 'disabled',
          trustServerCertificate: 'enabled',
          connectionTimeout: 30_000,
        },
      },
    ] as const)(
      'a saved $oauth.provider connection replaces exactly the params its tools declare it supplies',
      async ({ providerId, oauth, saved, input }) => {
        encryptionMockFns.mockEncryptSecret.mockImplementation(async (plain: string) => ({
          encrypted: plain,
          iv: 'iv',
        }))
        encryptionMockFns.mockDecryptSecret.mockImplementation(async (encrypted: string) => ({
          decrypted: encrypted,
        }))
        const { encryptedServiceAccountKey } = await verifyAndEncryptDatabaseConnection(
          providerId,
          JSON.stringify(saved)
        )
        queueTableRows(credential, [{ ...row, providerId, encryptedServiceAccountKey }])

        const response = await withSavedDatabaseConnection(
          providerId,
          echo
        )(
          call({
            input,
            context: {
              ...savedConnectionContext,
              authorizedServiceAccountCredential: {
                credentialId: 'credential-1',
                service: oauth.provider,
              },
            },
          })
        )

        const ran: Record<string, unknown> = await response.json()
        const inline: Record<string, unknown> = input
        const replaced = Object.keys(ran).filter((key) => ran[key] !== inline[key])
        expect(replaced.sort()).toEqual([...oauth.credentialSuppliedParams].sort())
      }
    )

    it.each([
      ['a credential for another engine', { providerId: 'mysql-service-account' }, stored],
      ['an organization credential', { organizationId: 'organization-1' }, stored],
      ['another engine’s blob', {}, { ...stored, type: 'mysql_connection_v1' }],
      [
        'a blob with an unknown stored field',
        {},
        { ...stored, connection: { ...connection, extra: 'x' } },
      ],
    ])('refuses %s with 403 and never runs', async (_case, rowOverride, blob) => {
      queueTableRows(credential, [{ ...row, ...rowOverride }])
      encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: JSON.stringify(blob) })

      const response = await withSavedDatabaseConnection(
        'postgresql-service-account',
        handler
      )(call({ context: savedConnectionContext }))

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
            context: savedConnectionContext,
          })
        )
      ).rejects.toThrow('run cancelled')
      expect(handler).not.toHaveBeenCalled()
    })
  })
})
