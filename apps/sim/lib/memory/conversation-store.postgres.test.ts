/**
 * @vitest-environment node
 */
import { readFile } from 'node:fs/promises'
import { generateId } from '@sim/utils/id'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({ current: undefined as PostgresJsDatabase | undefined }))
vi.unmock('drizzle-orm')
vi.unmock('@sim/db/schema')
vi.mock('@sim/db', () => ({
  dbFor: () => {
    if (!database.current) throw new Error('Postgres test is not initialized')
    return database.current
  },
  db: {
    select: (...args: unknown[]) => {
      if (!database.current) throw new Error('Postgres test is not initialized')
      return Reflect.apply(database.current.select, database.current, args)
    },
    transaction: (...args: unknown[]) => {
      if (!database.current) throw new Error('Postgres test is not initialized')
      return Reflect.apply(database.current.transaction, database.current, args)
    },
  },
}))
vi.mock('@sim/platform-authz/workspace', () => ({
  resolveEffectiveWorkspacePermission: async () => 'write',
  permissionSatisfies: () => true,
}))
vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: async () => principal(),
}))
vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: async (value: string) => ({ decrypted: value.replace('cipher-', 'secret-') }),
}))
vi.mock('@/lib/logs/execution/pii-redaction', () => ({
  redactObjectStrings: async (value: unknown) => value,
}))
vi.mock('@/lib/tokenization/accurate', () => ({
  getAccurateTokenCount: (text: string) => text.length,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: async (workspaceId: string) => ({
    workspaceId,
    workspaceOrganizationId: null,
    allowPersonalApiKeys: true,
    billedAccountUserId: 'user-1',
  }),
}))

import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import { executionLargeValues } from '@sim/db/schema'
import { hashDurableSecretProvenanceValue } from '@/lib/execution/durable-secret-provenance'
import { unreferencedLargeValuePredicate } from '@/lib/execution/payloads/large-value-metadata'
import {
  appendMemoryUseCase,
  deleteMemoryUseCase,
  readMemoryUseCase,
} from '@/lib/memory/application/use-cases'
import {
  type AgentMemoryTurnIdentity,
  openAgentMemoryTurn,
  readConversationItems,
  readPlainMemoryTail,
  saveAgentMemoryTurn,
} from '@/lib/memory/conversation-store'
import { retrieveMemory } from '@/lib/memory/retrieval'
import {
  getMemoryMessageAppendKey,
  getMemoryMessageTurnId,
  Memory,
} from '@/executor/handlers/agent/memory'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const databaseUrl = process.env.MEMORY_PROVENANCE_TEST_DATABASE_URL
if (databaseUrl && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)) {
  throw new Error('Memory tests require a local database')
}
const schemaName = `memory_storage_${generateId().replaceAll('-', '')}`
const connection = databaseUrl
  ? postgres(databaseUrl, {
      max: 8,
      connection: { search_path: `${schemaName},public` },
      onnotice: () => {},
    })
  : undefined
const identity: AgentMemoryTurnIdentity = {
  workspaceId: 'workspace-1',
  workflowId: 'workflow-1',
  executionId: 'execution-1',
  blockId: 'agent-1',
  nodeId: 'agent-1',
  executionOrder: 0,
  conversationId: 'conversation-1',
}
const provenance = { status: 'exact', entries: [] } as const
const journalReads: string[] = []
const deduplicationReads: string[] = []
const prefix = [
  { role: 'user', content: 'legacy question' },
  { role: 'assistant', content: 'legacy answer' },
]
const exchange = {
  version: 1,
  turnId: 'historical-turn',
  stepId: 'step-1',
  messages: [
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call-1',
          type: 'function',
          function: { name: 'lookup', arguments: '{"query":"test"}' },
        },
      ],
    },
    { role: 'tool', tool_call_id: 'call-1', content: 'result' },
  ],
}

function principal(): WorkflowExecutionDelegatedPrincipal {
  return {
    kind: 'delegated',
    serviceId: 'executor',
    workspaceId: identity.workspaceId,
    delegationId: 'delegation-1',
    audience: 'sim:memory',
    issuedAt: new Date(Date.now() - 1000),
    expiresAt: new Date(Date.now() + 60000),
    delegationContext: {
      kind: 'workflow_execution',
      workflowId: identity.workflowId,
      executionId: identity.executionId,
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      currentWorkflow: {
        workflowId: identity.workflowId,
        mode: 'deployment',
        deploymentVersionId: 'deployment-1',
      },
    },
  }
}

async function writeLegacyPrefix() {
  if (!connection) throw new Error('No test database')
  await connection`INSERT INTO memory (id, workspace_id, key, data, secret_provenance_version) VALUES ('legacy-memory', ${identity.workspaceId}, ${identity.conversationId}, ${JSON.stringify(prefix)}::jsonb, 1)`
  await connection`INSERT INTO memory_secret_provenance (memory_id, content_hash, status, entries) VALUES ('legacy-memory', ${hashDurableSecretProvenanceValue(prefix)}, 'exact', '[]')`
}

describe.skipIf(!databaseUrl)('conversation storage in Postgres', () => {
  beforeAll(async () => {
    if (!connection) return
    await connection`CREATE SCHEMA ${connection(schemaName)}`
    database.current = drizzle(connection, {
      logger: {
        logQuery(query) {
          if (query.startsWith('select ') && query.includes('agent_memory_turn'))
            journalReads.push(query)
          if (
            query.startsWith('select ') &&
            query.includes('from "memory_item"') &&
            query.includes('"memory_item"."append_key" in')
          )
            deduplicationReads.push(query)
        },
      },
    })
    await connection.unsafe(`
      CREATE TABLE workflow (id text PRIMARY KEY);
      CREATE TABLE execution_large_values (key text PRIMARY KEY, workspace_id text NOT NULL, owner_execution_id text NOT NULL, deleted_at timestamp);
      CREATE TABLE execution_large_value_references (key text NOT NULL, execution_id text NOT NULL, source text NOT NULL);
      CREATE TABLE execution_large_value_dependencies (parent_key text NOT NULL, child_key text NOT NULL, workspace_id text NOT NULL);
      CREATE TABLE workflow_execution_logs (execution_id text PRIMARY KEY);
      CREATE TABLE paused_executions (execution_id text PRIMARY KEY, status text NOT NULL);
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
      INSERT INTO workflow (id) VALUES ('workflow-1');
    `)
    for (const name of ['0368_durable_agent_memory']) {
      const migration = await readFile(
        new URL(`../../../../packages/db/migrations/${name}.sql`, import.meta.url),
        'utf8'
      )
      await connection.unsafe(migration.replaceAll('"public".', `"${schemaName}".`))
    }
  })
  beforeEach(async () => {
    if (connection) await connection`DELETE FROM memory`
    journalReads.length = 0
  })
  afterAll(async () => {
    if (!connection) return
    try {
      await connection`DROP SCHEMA ${connection(schemaName)} CASCADE`
    } finally {
      await connection.end()
    }
  })

  it('shares append locking and provenance across native/API writers before and after activation', async () => {
    const service = new Memory()
    const ctx = {
      workspaceId: identity.workspaceId,
      resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
    } as ExecutionContext
    const inputs = { memoryType: 'conversation' as const, conversationId: identity.conversationId }
    const seed = { role: 'user' as const, content: 'seed' }
    await service.seedMemory(ctx, inputs, [seed])
    const nativeMessage = { role: 'assistant' as const, content: 'native legacy' }
    const apiMessage = { role: 'user', content: 'API legacy', custom: { preserved: true } }
    await Promise.all([
      service.appendToMemory(ctx, inputs, nativeMessage),
      appendMemoryUseCase.execute({
        principal: principal(),
        input: {
          workspaceId: identity.workspaceId,
          key: identity.conversationId,
          data: apiMessage,
          writeProvenance: provenance,
        },
      }),
    ])
    const [legacy] =
      await connection!`SELECT id, data, storage_version FROM memory WHERE key = ${identity.conversationId}`
    expect(legacy.storage_version).toBe(1)
    expect(legacy.data).toHaveLength(3)
    expect(legacy.data).toEqual(expect.arrayContaining([seed, nativeMessage, apiMessage]))
    const [sidecar] =
      await connection!`SELECT content_hash, status FROM memory_secret_provenance WHERE memory_id = ${legacy.id}`
    expect(sidecar).toEqual({
      content_hash: hashDurableSecretProvenanceValue(legacy.data),
      status: 'exact',
    })

    const turn = await openAgentMemoryTurn(identity)
    await service.seedMemory(ctx, inputs, [
      { role: 'user', content: 'must not replace existing history' },
    ])
    const nativeTail = { role: 'assistant' as const, content: 'native tail' }
    const apiTail = { role: 'user', content: 'API tail', custom: { preserved: true } }
    await Promise.all([
      service.appendToMemory(ctx, inputs, nativeTail),
      appendMemoryUseCase.execute({
        principal: principal(),
        input: {
          workspaceId: identity.workspaceId,
          key: identity.conversationId,
          data: apiTail,
          writeProvenance: provenance,
        },
      }),
    ])
    const [activated] =
      await connection!`SELECT data, storage_version FROM memory WHERE id = ${turn.memoryId}`
    expect(activated).toEqual({ data: legacy.data, storage_version: 2 })
    const tail = await readPlainMemoryTail(turn.memoryId, identity.workspaceId)
    expect(tail.messages).toHaveLength(2)
    expect(tail.messages).toEqual(expect.arrayContaining([nativeTail, apiTail]))
    expect(tail.provenance).toEqual(provenance)
  })

  it('freezes the legacy prefix and keeps exchanges out of native/plain API history', async () => {
    await writeLegacyPrefix()
    const turn = await openAgentMemoryTurn(identity)
    await saveAgentMemoryTurn({
      ...identity,
      ...turn,
      expectedRevision: turn.revision,
      encryptedState: 'encrypted',
      items: [{ appendKey: 'exchange-1', kind: 'exchange', data: exchange, provenance }],
    })
    const message = { role: 'assistant', content: 'new answer' }
    await new Memory().appendToMemory(
      { workspaceId: identity.workspaceId } as ExecutionContext,
      { memoryType: 'conversation', conversationId: identity.conversationId },
      message
    )
    const result = await readMemoryUseCase.execute({
      principal: principal(),
      input: {
        workspaceId: identity.workspaceId,
        key: identity.conversationId,
        includePersistedSecretProvenance: true,
      },
    })
    expect(result.record?.data).toEqual([...prefix, message])
    expect(result.readProvenance?.[0].provenance.status).toBe('exact')
    expect(
      (
        await readConversationItems({ workspaceId: identity.workspaceId, memoryId: turn.memoryId })
      ).items.map((item) => item.kind)
    ).toEqual(['message', 'exchange'])
    const [stored] =
      await connection!`SELECT data, storage_version FROM memory WHERE id = ${turn.memoryId}`
    expect(stored).toMatchObject({ data: prefix, storage_version: 2 })
    const replay = await new Memory().fetchMemoryMessages(
      { workspaceId: identity.workspaceId } as ExecutionContext,
      { memoryType: 'conversation', conversationId: identity.conversationId }
    )
    expect(replay).toEqual([...prefix, message])
  })

  it('preserves API message payloads and extra fields after activation', async () => {
    const turn = await openAgentMemoryTurn(identity)
    const message = { role: 'user', content: { custom: 'structured content' }, customField: true }
    const result = await appendMemoryUseCase.execute({
      principal: principal(),
      input: { workspaceId: identity.workspaceId, key: identity.conversationId, data: message },
    })
    expect(result.record.data).toEqual([message])
    expect((await readPlainMemoryTail(turn.memoryId, identity.workspaceId)).messages).toEqual([
      message,
    ])
    const [stored] = await connection!`SELECT data FROM memory WHERE id = ${turn.memoryId}`
    expect(stored.data).toEqual([])
  })

  it('deduplicates simultaneous opens and admits only one CAS writer', async () => {
    const turns = await Promise.all([openAgentMemoryTurn(identity), openAgentMemoryTurn(identity)])
    expect(turns[0]).toEqual(turns[1])
    const outcomes = await Promise.allSettled(
      ['first', 'second'].map((encryptedState) =>
        saveAgentMemoryTurn({
          ...identity,
          ...turns[0],
          expectedRevision: 0,
          encryptedState,
          items: [
            { appendKey: encryptedState, kind: 'exchange', data: { encryptedState }, provenance },
          ],
        })
      )
    )
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    expect((await openAgentMemoryTurn(identity)).revision).toBe(1)
    expect(
      (
        await readConversationItems({
          workspaceId: identity.workspaceId,
          memoryId: turns[0].memoryId,
        })
      ).items
    ).toHaveLength(1)
  })

  it('deduplicates committed history and rolls back journal advancement on conflicting content', async () => {
    deduplicationReads.length = 0
    const turn = await openAgentMemoryTurn(identity)
    const item = {
      appendKey: 'stable-exchange',
      kind: 'exchange' as const,
      data: exchange,
      provenance,
    }
    await saveAgentMemoryTurn({
      ...identity,
      ...turn,
      expectedRevision: 0,
      encryptedState: 'first',
      items: [item],
    })
    await saveAgentMemoryTurn({
      ...identity,
      ...turn,
      expectedRevision: 1,
      encryptedState: 'second',
      items: [item],
    })
    await expect(
      saveAgentMemoryTurn({
        ...identity,
        ...turn,
        expectedRevision: 2,
        encryptedState: 'must-rollback',
        items: [{ ...item, data: { different: true } }],
      })
    ).rejects.toThrow('Memory append identity was already used')
    expect(await openAgentMemoryTurn(identity)).toMatchObject({
      revision: 2,
      encryptedState: 'second',
    })
    expect(
      (await readConversationItems({ workspaceId: identity.workspaceId, memoryId: turn.memoryId }))
        .items
    ).toHaveLength(1)
    expect(deduplicationReads).toHaveLength(3)
    for (const query of deduplicationReads) {
      expect(query.split(' from ')[0]).toBe('select "append_key", "content_hash", "kind"')
    }
  })

  it('deletion cascades history and forbids stale writers from resurrecting a recreated key', async () => {
    const previous = await openAgentMemoryTurn(identity)
    await saveAgentMemoryTurn({
      ...identity,
      ...previous,
      expectedRevision: 0,
      encryptedState: 'saved',
      items: [{ appendKey: 'exchange', kind: 'exchange', data: exchange, provenance }],
    })
    await deleteMemoryUseCase.execute({
      principal: principal(),
      input: { workspaceId: identity.workspaceId, key: identity.conversationId },
    })
    const replacement = await openAgentMemoryTurn(identity)
    expect(replacement.memoryId).not.toBe(previous.memoryId)
    await expect(
      saveAgentMemoryTurn({
        ...identity,
        ...previous,
        expectedRevision: 1,
        encryptedState: 'stale',
      })
    ).rejects.toThrow('Conversation no longer exists')
    const [{ count }] = await connection!`SELECT count(*)::int AS count FROM memory_item`
    expect(count).toBe(0)
    expect((await openAgentMemoryTurn(identity)).revision).toBe(0)
  })

  it('pages complete groups newest first and scopes reads to the workspace', async () => {
    const turn = await openAgentMemoryTurn(identity)
    await saveAgentMemoryTurn({
      ...identity,
      ...turn,
      expectedRevision: 0,
      encryptedState: 'saved',
      items: [1, 2, 3].map((number) => ({
        appendKey: String(number),
        kind: 'exchange',
        data: { number },
        provenance,
      })),
    })
    const first = await readConversationItems({
      workspaceId: identity.workspaceId,
      memoryId: turn.memoryId,
      limit: 2,
    })
    expect(first.items.map((item) => item.data)).toEqual([{ number: 3 }, { number: 2 }])
    const second = await readConversationItems({
      workspaceId: identity.workspaceId,
      memoryId: turn.memoryId,
      limit: 2,
      beforeSequence: first.nextBeforeSequence,
    })
    expect(second.items.map((item) => item.data)).toEqual([{ number: 1 }])
    expect(second.nextBeforeSequence).toBeUndefined()
    expect(
      (await readConversationItems({ workspaceId: 'other-workspace', memoryId: turn.memoryId }))
        .items
    ).toEqual([])
  })
  it('keeps exchanges outside conversational message slots and counts their arguments', async () => {
    await writeLegacyPrefix()
    const turn = await openAgentMemoryTurn(identity)
    await saveAgentMemoryTurn({
      ...identity,
      ...turn,
      expectedRevision: 0,
      encryptedState: 'saved',
      items: [{ appendKey: 'exchange', kind: 'exchange', data: exchange, provenance }],
    })
    const service = new Memory()
    const ctx = { workspaceId: identity.workspaceId } as ExecutionContext
    const history = await service.fetchMemoryMessages(
      ctx,
      {
        memoryType: 'sliding_window',
        slidingWindowSize: '1',
        conversationId: identity.conversationId,
      },
      undefined,
      { richHistory: true }
    )
    expect(history).toEqual([prefix[1], ...exchange.messages])
    const tokenWindow = await service.fetchMemoryMessages(
      ctx,
      {
        memoryType: 'sliding_window_tokens',
        slidingWindowTokens: '1',
        conversationId: identity.conversationId,
      },
      undefined,
      { richHistory: true }
    )
    expect(tokenWindow).toEqual(exchange.messages)
  })

  it('deduplicates per-turn inputs, excludes only current exchanges, and keeps identity private', async () => {
    const turn = await openAgentMemoryTurn(identity)
    const ctx = { workspaceId: identity.workspaceId } as ExecutionContext
    const inputs = { memoryType: 'conversation' as const, conversationId: identity.conversationId }
    const message = { role: 'user' as const, content: 'current input' }
    const options = { memoryId: turn.memoryId, turnId: turn.turnId, appendKey: 'input' }
    const service = new Memory()
    await service.appendToMemory(ctx, inputs, message, options)
    await service.appendToMemory(ctx, inputs, message, options)
    await saveAgentMemoryTurn({
      ...identity,
      ...turn,
      expectedRevision: 0,
      encryptedState: 'saved',
      items: [
        {
          appendKey: 'exchange',
          kind: 'exchange',
          data: { ...exchange, turnId: turn.turnId },
          provenance,
        },
      ],
    })
    const history = await service.fetchMemoryMessages(ctx, inputs, undefined, {
      richHistory: true,
      excludeTurnId: turn.turnId,
    })
    expect(history).toEqual([message])
    expect(getMemoryMessageTurnId(history[0])).toBe(turn.turnId)
    expect(getMemoryMessageAppendKey(history[0])).toBe('input')
    expect(JSON.stringify(history)).toBe(JSON.stringify([message]))
    const secondTurn = await openAgentMemoryTurn({ ...identity, executionOrder: 1 })
    await service.appendToMemory(ctx, inputs, message, { ...options, turnId: secondTurn.turnId })
    expect((await readPlainMemoryTail(turn.memoryId, identity.workspaceId)).messages).toEqual([
      message,
      message,
    ])
  })
  it('retains memory artifacts and their children without run logs until the conversation is deleted', async () => {
    const turn = await openAgentMemoryTurn(identity)
    await connection!`INSERT INTO execution_large_values (key, workspace_id, owner_execution_id) VALUES ('parent-artifact', ${identity.workspaceId}, 'old-run'), ('child-artifact', ${identity.workspaceId}, 'old-run')`
    await connection!`INSERT INTO execution_large_value_dependencies (parent_key, child_key, workspace_id) VALUES ('parent-artifact', 'child-artifact', ${identity.workspaceId})`
    await connection!`INSERT INTO memory_artifact (memory_id, key) VALUES (${turn.memoryId}, 'parent-artifact')`
    const collectible = () =>
      database
        .current!.select({ key: executionLargeValues.key })
        .from(executionLargeValues)
        .where(unreferencedLargeValuePredicate())
    expect(await collectible()).toEqual([])
    await connection!`UPDATE memory SET deleted_at = now() WHERE id = ${turn.memoryId}`
    expect((await collectible()).map((row) => row.key).sort()).toEqual([
      'child-artifact',
      'parent-artifact',
    ])
    await connection!`DELETE FROM memory WHERE id = ${turn.memoryId}`
    expect(await connection!`SELECT * FROM memory_artifact`).toHaveLength(0)
  })
  it('rejects two conflicting values for one append identity before committing the checkpoint', async () => {
    const turn = await openAgentMemoryTurn(identity)
    await expect(
      saveAgentMemoryTurn({
        ...identity,
        ...turn,
        expectedRevision: 0,
        encryptedState: 'must-rollback',
        items: [1, 2].map((value) => ({
          appendKey: 'same-key',
          kind: 'exchange',
          data: { value },
          provenance,
        })),
      })
    ).rejects.toThrow('Memory append identity was already used')
    expect(await openAgentMemoryTurn(identity)).toMatchObject({ revision: 0, encryptedState: null })
    expect(
      (await readConversationItems({ workspaceId: identity.workspaceId, memoryId: turn.memoryId }))
        .items
    ).toEqual([])
  })

  it('ignores provenance outside the selected window while refusing selected changed exchanges', async () => {
    const turn = await openAgentMemoryTurn(identity)
    await saveAgentMemoryTurn({
      ...identity,
      ...turn,
      expectedRevision: 0,
      encryptedState: 'saved',
      items: [{ appendKey: 'exchange', kind: 'exchange', data: exchange, provenance }],
    })
    await connection!`UPDATE memory_item SET content_hash = 'mismatched' WHERE memory_id = ${turn.memoryId}`
    const latest = { role: 'assistant' as const, content: 'new safe answer' }
    const service = new Memory()
    const ctx = { workspaceId: identity.workspaceId } as ExecutionContext
    await service.appendToMemory(
      ctx,
      { memoryType: 'conversation', conversationId: identity.conversationId },
      latest
    )
    await expect(
      service.fetchMemoryMessages(
        ctx,
        {
          memoryType: 'sliding_window',
          slidingWindowSize: '1',
          conversationId: identity.conversationId,
        },
        undefined,
        { richHistory: true }
      )
    ).resolves.toEqual([latest])
  })

  it('refuses oversized saved ciphertext before admitting a recovery checkpoint', async () => {
    const turn = await openAgentMemoryTurn(identity)
    await connection!`UPDATE agent_memory_turn SET encrypted_state = repeat('oversized-ciphertext', 300000) WHERE id = ${turn.turnId}`
    await expect(openAgentMemoryTurn(identity)).rejects.toMatchObject({ code: 'payload_too_large' })
    expect(journalReads.at(-1)).toContain('CASE WHEN octet_length(')
    expect(journalReads.at(-1)).toContain('ELSE NULL END')
    expect(
      (await connection!`SELECT revision FROM agent_memory_turn WHERE id = ${turn.turnId}`)[0]
        .revision
    ).toBe(0)
  })

  it('drops stale native inputs after deletion and inputs bound to another execution', async () => {
    const turn = await openAgentMemoryTurn(identity)
    const service = new Memory()
    const ctx = { workspaceId: identity.workspaceId } as ExecutionContext
    const inputs = { memoryType: 'conversation' as const, conversationId: identity.conversationId }
    const options = { memoryId: turn.memoryId, turnId: turn.turnId, appendKey: 'input' }
    await connection!`UPDATE agent_memory_turn SET execution_id = 'other-execution' WHERE id = ${turn.turnId}`
    await expect(
      service.appendToMemory(ctx, inputs, { role: 'user', content: 'foreign' }, options)
    ).resolves.toBeUndefined()
    await deleteMemoryUseCase.execute({
      principal: principal(),
      input: { workspaceId: identity.workspaceId, key: identity.conversationId },
    })
    await openAgentMemoryTurn(identity)
    await expect(
      service.appendToMemory(ctx, inputs, { role: 'user', content: 'stale' }, options)
    ).resolves.toBeUndefined()
    expect(await connection!`SELECT * FROM memory_item`).toEqual([])
  })

  it('refuses a changed exchange whose private provenance no longer matches its contents', async () => {
    const turn = await openAgentMemoryTurn(identity)
    await saveAgentMemoryTurn({
      ...identity,
      ...turn,
      expectedRevision: 0,
      encryptedState: 'saved',
      items: [{ appendKey: 'exchange', kind: 'exchange', data: exchange, provenance }],
    })
    const modified = {
      ...exchange,
      messages: exchange.messages.map((message) =>
        message.role === 'tool' ? { ...message, content: 'unexpected stored bytes' } : message
      ),
    }
    await connection!`UPDATE memory_item SET data = ${JSON.stringify(modified)}::jsonb WHERE memory_id = ${turn.memoryId}`
    expect(
      (await readConversationItems({ workspaceId: identity.workspaceId, memoryId: turn.memoryId }))
        .items[0].provenance.status
    ).toBe('unknown')
    await expect(
      new Memory().fetchMemoryMessages(
        { workspaceId: identity.workspaceId } as ExecutionContext,
        { memoryType: 'conversation', conversationId: identity.conversationId },
        undefined,
        { richHistory: true }
      )
    ).rejects.toThrow('Memory content could not be safely projected')
    expect((await readPlainMemoryTail(turn.memoryId, identity.workspaceId)).messages).toEqual([])
  })
  it('rejects an oversized compatibility append before writing any new message rows', async () => {
    const turn = await openAgentMemoryTurn(identity)
    await expect(
      appendMemoryUseCase.execute({
        principal: principal(),
        input: {
          workspaceId: identity.workspaceId,
          key: identity.conversationId,
          data: Array.from({ length: 10001 }, () => ({ role: 'user', content: 'not committed' })),
        },
      })
    ).rejects.toMatchObject({ code: 'payload_too_large' })
    expect(
      await connection!`SELECT id FROM memory_item WHERE memory_id = ${turn.memoryId}`
    ).toEqual([])
    expect(
      (await connection!`SELECT data FROM memory WHERE id = ${turn.memoryId}`)[0].data
    ).toEqual([])
  })

  it('counts existing and proposed JSON bytes together before committing a compatibility append', async () => {
    const turn = await openAgentMemoryTurn(identity)
    const existing = { role: 'user', content: 'x'.repeat(8 * 1024 * 1024) }
    await connection!`INSERT INTO memory_item (id, memory_id, append_key, kind, data, content_hash, provenance_status, provenance_entries) VALUES ('existing-large-item', ${turn.memoryId}, 'existing', 'message', ${JSON.stringify(existing)}::jsonb, ${hashDurableSecretProvenanceValue(existing)}, 'exact', '[]')`
    await expect(
      appendMemoryUseCase.execute({
        principal: principal(),
        input: {
          workspaceId: identity.workspaceId,
          key: identity.conversationId,
          data: { role: 'assistant', content: 'y'.repeat(8 * 1024 * 1024) },
        },
      })
    ).rejects.toMatchObject({ code: 'payload_too_large' })
    expect(
      await connection!`SELECT id FROM memory_item WHERE memory_id = ${turn.memoryId}`
    ).toEqual([{ id: 'existing-large-item' }])
  })

  it('finds older retained matches after a no-match page reaches the retrieval byte limit', async () => {
    const turn = await openAgentMemoryTurn(identity)
    await saveAgentMemoryTurn({
      ...identity,
      ...turn,
      expectedRevision: 0,
      encryptedState: 'saved',
      items: [
        {
          appendKey: 'older-match',
          kind: 'message',
          data: { role: 'user', content: 'older retained receipt needle' },
          provenance,
        },
        ...Array.from({ length: 5 }, (_, index) => ({
          appendKey: `large-unrelated-${index}`,
          kind: 'message' as const,
          data: { role: 'assistant', content: 'x'.repeat(1024 * 1024 - 1024) },
          provenance,
        })),
      ],
    })
    const scope = { workspaceId: identity.workspaceId, memoryId: turn.memoryId }
    const contextPage = await readConversationItems({ ...scope, limit: 10 })
    expect(contextPage.items).toHaveLength(4)
    expect(contextPage.nextBeforeSequence).toBeUndefined()

    const args = { target: 'history' as const, query: 'receipt needle' }
    const first = await retrieveMemory({ ...scope, arguments: args, projection: {} })
    expect(first).toMatchObject({ text: '', scannedItems: 4, nextCursor: expect.any(String) })
    const next = await retrieveMemory({
      ...scope,
      arguments: { ...args, cursor: first.nextCursor },
      projection: {},
    })
    expect(next.text).toContain('older retained receipt needle')
    expect(next.scannedItems).toBe(2)
  })

  it('reports a single oversized history item and advances to the end without repeating it', async () => {
    const turn = await openAgentMemoryTurn(identity)
    const oversized = { role: 'user', content: 'x'.repeat(5 * 1024 * 1024) }
    await connection!`INSERT INTO memory_item (id, memory_id, append_key, kind, data, content_hash, provenance_status, provenance_entries) VALUES ('oversized-retrieval-item', ${turn.memoryId}, 'oversized-retrieval', 'message', ${JSON.stringify(oversized)}::jsonb, ${hashDurableSecretProvenanceValue(oversized)}, 'exact', '[]')`
    const scope = { workspaceId: identity.workspaceId, memoryId: turn.memoryId }
    const args = { target: 'history' as const, query: 'needle' }
    const first = await retrieveMemory({ ...scope, arguments: args, projection: {} })
    expect(first.text).toBe('')
    expect(first.notice).toContain('not retrievable within the safe 4 MiB')
    expect(first.nextCursor).toEqual(expect.any(String))
    const next = await retrieveMemory({
      ...scope,
      arguments: { ...args, cursor: first.nextCursor },
      projection: {},
    })
    expect(next.nextCursor).toBeUndefined()
    expect(next.scannedItems).toBe(0)
  })
})
