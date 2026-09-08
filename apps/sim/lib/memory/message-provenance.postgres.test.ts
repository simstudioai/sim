/**
 * @vitest-environment node
 *
 * Uses a disposable schema in a local PostgreSQL database. From apps/sim, run:
 * `MEMORY_PROVENANCE_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/postgres bun run test lib/memory/message-provenance.postgres.test.ts`
 */
import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { generateId } from '@sim/utils/id'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { database, mockIsEnforced } = vi.hoisted(() => ({
  database: { current: undefined as PostgresJsDatabase | undefined },
  mockIsEnforced: vi.fn(),
}))

vi.unmock('drizzle-orm')
vi.unmock('@sim/db/schema')
vi.mock('@sim/db', () => ({
  db: {
    select: (...args: unknown[]) => {
      if (!database.current) throw new Error('PostgreSQL test database is not initialized')
      return Reflect.apply(database.current.select, database.current, args)
    },
    transaction: (...args: unknown[]) => {
      if (!database.current) throw new Error('PostgreSQL test database is not initialized')
      return Reflect.apply(database.current.transaction, database.current, args)
    },
  },
}))
vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: async (value: string) => ({ decrypted: value.replace('cipher-', 'secret-') }),
}))
vi.mock('@/lib/execution/durable-secret-provenance-enforcement', () => ({
  isDurableSecretProvenanceEnforced: mockIsEnforced,
  reportUnrecordedDurableProvenance: vi.fn(),
}))
vi.mock('@/lib/logs/execution/pii-redaction', () => ({
  redactObjectStrings: async (value: unknown) => value,
}))
vi.mock('@/lib/tokenization/accurate', () => ({
  getAccurateTokenCount: (text: string) => text.length,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: async () => ({
    workspaceId: 'workspace-1',
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
    billedAccountUserId: 'user-1',
  }),
}))

import { hashDurableSecretProvenanceValue } from '@/lib/execution/durable-secret-provenance'
import { appendMemoryUseCase } from '@/lib/memory/application/use-cases'
import { Memory } from '@/executor/handlers/agent/memory'
import type { AgentInputs } from '@/executor/handlers/agent/types'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const databaseUrl = process.env.MEMORY_PROVENANCE_TEST_DATABASE_URL
if (databaseUrl && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)) {
  throw new Error('Memory provenance PostgreSQL tests require a local database')
}
const schemaName = `memory_provenance_${generateId().replaceAll('-', '')}`
const connection = databaseUrl
  ? postgres(databaseUrl, {
      max: 8,
      connection: { search_path: `${schemaName},public` },
      onnotice: () => {},
    })
  : undefined
const SCOPE = { userId: 'user-1', workspaceId: 'workspace-1' }

function principal(): WorkflowExecutionDelegatedPrincipal {
  return {
    kind: 'delegated',
    serviceId: 'executor',
    workspaceId: SCOPE.workspaceId,
    delegationId: 'delegation-1',
    audience: 'sim:memory',
    issuedAt: new Date(Date.now() - 1_000),
    expiresAt: new Date(Date.now() + 60_000),
    delegationContext: {
      kind: 'workflow_execution',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      principal: {
        kind: 'system',
        serviceId: 'schedule',
        workspaceId: SCOPE.workspaceId,
        workflowId: 'workflow-1',
      },
      currentWorkflow: {
        workflowId: 'workflow-1',
        mode: 'deployment',
        deploymentVersionId: 'deployment-1',
      },
    },
  }
}

function context(registry = new ResolvedSecretTraceRegistry([], SCOPE)) {
  return {
    workspaceId: SCOPE.workspaceId,
    resolvedSecretTraceRegistry: registry,
  } as ExecutionContext
}

function inputs(key: string): AgentInputs {
  return { memoryType: 'conversation', conversationId: key } as AgentInputs
}

async function toolAppend(key: string, suffix: string) {
  return appendMemoryUseCase.execute({
    principal: principal(),
    input: {
      workspaceId: SCOPE.workspaceId,
      key,
      data: { role: 'user', content: `secret-${suffix}` },
      writeProvenance: {
        status: 'exact',
        entries: [
          {
            encryptedValue: `cipher-${suffix}`,
            name: `TOKEN_${suffix}`,
            sourceUserId: SCOPE.userId,
            sourceWorkspaceId: SCOPE.workspaceId,
          },
        ],
      },
    },
  })
}

async function nativeAppend(key: string, suffix: string) {
  const registry = new ResolvedSecretTraceRegistry(
    [
      {
        name: `TOKEN_${suffix}`,
        plaintext: `secret-${suffix}`,
        encryptedValue: `cipher-${suffix}`,
      },
    ],
    SCOPE
  )
  registry.recordResolved(`TOKEN_${suffix}`, `secret-${suffix}`)
  return new Memory().appendToMemory(context(registry), inputs(key), {
    role: 'user',
    content: `secret-${suffix}`,
  })
}

describe.skipIf(!databaseUrl)('memory provenance in PostgreSQL', () => {
  beforeAll(async () => {
    if (!connection) throw new Error('PostgreSQL test database is not initialized')
    await connection`CREATE SCHEMA ${connection(schemaName)}`
    database.current = drizzle(connection)
    await connection.unsafe(`
      CREATE TABLE memory (
        id text PRIMARY KEY, workspace_id text NOT NULL, key text NOT NULL, data jsonb NOT NULL,
        secret_provenance_version integer, created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now(), deleted_at timestamp,
        UNIQUE(workspace_id, key)
      );
      CREATE TABLE memory_secret_provenance (
        memory_id text PRIMARY KEY REFERENCES memory(id) ON DELETE CASCADE,
        content_hash text NOT NULL, status text NOT NULL, entries jsonb NOT NULL,
        updated_at timestamp NOT NULL DEFAULT now()
      );
      CREATE FUNCTION demote_memory() RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN
          NEW.secret_provenance_version := NULL;
          RETURN NEW;
        END;
      $body$;
      CREATE TRIGGER memory_demote BEFORE UPDATE OF data ON memory FOR EACH ROW
        WHEN(OLD.data IS DISTINCT FROM NEW.data) EXECUTE FUNCTION demote_memory();
    `)
  })

  afterAll(async () => {
    if (!connection) return
    try {
      await connection`DROP SCHEMA ${connection(schemaName)} CASCADE`
    } finally {
      database.current = undefined
      await connection.end()
    }
  })

  describe.each([false, true])('enforcement %s', (enforced) => {
    it('keeps a large one-secret conversation exact across tool and native writes and model reads', async () => {
      if (!connection) throw new Error('PostgreSQL test database is not initialized')
      mockIsEnforced.mockReturnValue(enforced)
      const key = `large-conversation-${enforced}`
      const messages = Array.from({ length: 17_000 }, (_, index) => ({
        role: 'user',
        content: `secret-SHARED message-${index}`,
      }))
      await appendMemoryUseCase.execute({
        principal: principal(),
        input: {
          workspaceId: SCOPE.workspaceId,
          key,
          data: messages,
          writeProvenance: {
            status: 'exact',
            entries: [
              {
                encryptedValue: 'cipher-SHARED',
                name: 'TOKEN_SHARED',
                sourceUserId: SCOPE.userId,
                sourceWorkspaceId: SCOPE.workspaceId,
              },
            ],
          },
        },
      })
      await nativeAppend(key, 'SHARED')
      await toolAppend(key, 'SHARED')
      const [record] = await connection`
        SELECT m.data, m.secret_provenance_version, p.content_hash, p.status, p.entries
        FROM memory m JOIN memory_secret_provenance p ON p.memory_id = m.id
        WHERE m.key = ${key}
      `
      expect(record.data).toHaveLength(messages.length + 2)
      expect(record.secret_provenance_version).toBe(1)
      expect(record.status).toBe('exact')
      expect(record.content_hash).toBe(hashDurableSecretProvenanceValue(record.data))
      expect(record.entries).toHaveLength(messages.length + 1)
      const execution = context()
      const selected = await new Memory().fetchMemoryMessages(execution, {
        ...inputs(key),
        memoryType: 'sliding_window',
        slidingWindowSize: '2',
      })
      expect(selected).toEqual([
        { role: 'user', content: '{{TOKEN_SHARED}}' },
        { role: 'user', content: '{{TOKEN_SHARED}}' },
      ])
      expect(execution.resolvedSecretTraceRegistry?.isComplete()).toBe(true)
    })

    it.each(['tool-tool', 'tool-native', 'native-native'] as const)(
      'preserves both first appends and secret bindings for %s',
      async (mode) => {
        if (!connection) throw new Error('PostgreSQL test database is not initialized')
        mockIsEnforced.mockReturnValue(enforced)
        for (let index = 0; index < 8; index++) {
          const key = `${enforced}-${mode}-${index}`
          await Promise.all([
            mode === 'native-native' ? nativeAppend(key, 'A') : toolAppend(key, 'A'),
            mode === 'tool-tool' ? toolAppend(key, 'B') : nativeAppend(key, 'B'),
          ])
          const [record] = await connection`
            SELECT m.data, m.secret_provenance_version, p.entries
            FROM memory m JOIN memory_secret_provenance p ON p.memory_id = m.id
            WHERE m.key = ${key}
          `
          expect(record.data).toHaveLength(2)
          expect(record.secret_provenance_version).toBe(1)
          expect(record.entries).toHaveLength(2)
          const result = await new Memory().fetchMemoryMessages(context(), inputs(key))
          expect(new Set(result.map((message) => message.content))).toEqual(
            new Set(['{{TOKEN_A}}', '{{TOKEN_B}}'])
          )
        }
      }
    )
  })
})
