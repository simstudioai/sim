/**
 * @vitest-environment node
 */
import type { WorkflowExecutionDelegatedPrincipal } from '@sim/auth/principal'
import type { DurableSecretProvenanceEntry } from '@sim/db/schema'
import { memory } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  decrypt: vi.fn(),
  isEnforced: vi.fn(),
  report: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  loadWorkspace: vi.fn(),
}))

vi.mock('@sim/logger', () => ({ createLogger: () => mocks.logger }))
vi.mock('@/lib/core/security/encryption', () => ({ decryptSecret: mocks.decrypt }))
vi.mock('@/lib/execution/durable-secret-provenance-enforcement', () => ({
  isDurableSecretProvenanceEnforced: mocks.isEnforced,
  reportUnrecordedDurableProvenance: mocks.report,
}))
vi.mock('@/lib/logs/execution/pii-redaction', () => ({
  redactObjectStrings: vi.fn(async (value: unknown) => value),
}))
vi.mock('@/lib/tokenization/accurate', () => ({
  getAccurateTokenCount: (text: string) => text.length,
}))
vi.mock('@/lib/workspaces/application/workspace-context', () => ({
  resolveActiveWorkspaceApplicationContext: mocks.loadWorkspace,
}))

import {
  type DurableSecretProvenance,
  hashDurableSecretProvenanceValue,
  importDurableSecretProvenance,
} from '@/lib/execution/durable-secret-provenance'
import {
  PRIVATE_SECRET_PROVENANCE_BUNDLE_V1,
  PRIVATE_SECRET_PROVENANCE_FIELD,
  PRIVATE_SECRET_PROVENANCE_HEADER,
} from '@/lib/execution/private-tool-metadata'
import { readMemoryWriteProvenance } from '@/lib/internal/memory/provenance'
import { appendMemoryUseCase } from '@/lib/memory/application/use-cases'
import {
  bindMemorySecretProvenanceToMessages,
  createMemorySecretProvenanceSelector,
} from '@/lib/memory/secret-provenance'
import { Memory } from '@/executor/handlers/agent/memory'
import type { AgentInputs, Message } from '@/executor/handlers/agent/types'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { memoryAddTool } from '@/tools/memory/add'

const SCOPE = { userId: 'user-1', workspaceId: 'workspace-1' }
const SECRET = 'known-secret-value'
const ENTRY = {
  name: 'TOKEN',
  encryptedValue: 'ciphertext',
  sourceUserId: SCOPE.userId,
  sourceWorkspaceId: SCOPE.workspaceId,
}
const INPUTS = { memoryType: 'conversation', conversationId: 'conversation-1' } as AgentInputs

function executionContext(registry = new ResolvedSecretTraceRegistry([], SCOPE)) {
  return {
    workspaceId: SCOPE.workspaceId,
    resolvedSecretTraceRegistry: registry,
  } as ExecutionContext
}

function queueStoredMemory(data: Message[], entries: readonly DurableSecretProvenanceEntry[]) {
  queueTableRows(memory, [
    {
      data,
      secretProvenanceVersion: 1,
      provenanceContentHash: hashDurableSecretProvenanceValue(data),
      provenanceStatus: 'exact',
      provenanceEntries: entries,
    },
  ])
}

interface MemoryWrites {
  appendMessage(
    workspaceId: string,
    key: string,
    message: Message,
    provenance: DurableSecretProvenance | undefined
  ): Promise<void>
  seedMemoryRecord(
    workspaceId: string,
    key: string,
    messages: Message[],
    provenance: DurableSecretProvenance | undefined
  ): Promise<void>
}

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

describe.each([false, true])('memory message provenance with enforcement %s', (enforced) => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
    mocks.isEnforced.mockReturnValue(enforced)
    mocks.decrypt.mockResolvedValue({ decrypted: SECRET })
    mocks.loadWorkspace.mockResolvedValue({
      workspaceId: SCOPE.workspaceId,
      workspaceOrganizationId: null,
      allowPersonalApiKeys: true,
      billedAccountUserId: SCOPE.userId,
    })
  })

  it('carries actual memory_add writes through the application and sidecar into native Agent memory', async () => {
    const wire = memoryAddTool.operation.input({
      conversationId: INPUTS.conversationId,
      role: 'user',
      content: SECRET,
    }) as { key: string; data: Message }
    const payload = {
      ...wire,
      [PRIVATE_SECRET_PROVENANCE_FIELD]: {
        version: 1,
        complete: true,
        selections: [
          {
            key: 'data',
            provenance: {
              version: 1,
              complete: true,
              entries: [{ name: ENTRY.name, encryptedValue: ENTRY.encryptedValue }],
              scope: SCOPE,
            },
          },
        ],
      },
    }
    const writeProvenance = readMemoryWriteProvenance(
      new Headers({ [PRIVATE_SECRET_PROVENANCE_HEADER]: PRIVATE_SECRET_PROVENANCE_BUNDLE_V1 }),
      payload,
      SCOPE
    )
    const data = [wire.data]
    queueTableRows(memory, [])
    queueTableRows(memory, [{ id: 'memory-1', key: wire.key, data, secretProvenanceVersion: 1 }])
    dbChainMockFns.returning
      .mockResolvedValueOnce([{ id: 'memory-1', data }])
      .mockResolvedValueOnce([{ id: 'memory-1' }])

    await appendMemoryUseCase.execute({
      principal: principal(),
      input: { workspaceId: SCOPE.workspaceId, key: wire.key, data: wire.data, writeProvenance },
    })

    const sidecar = dbChainMockFns.values.mock.calls
      .map(([value]) => value)
      .find((value) => value.memoryId === 'memory-1')
    expect(sidecar).toMatchObject({
      status: 'exact',
      entries: [{ ...ENTRY, sourceValueHash: hashDurableSecretProvenanceValue(wire.data) }],
    })
    expect(dbChainMockFns.execute.mock.invocationCallOrder[0]).toBeLessThan(
      dbChainMockFns.select.mock.invocationCallOrder[0]
    )
    queueStoredMemory(data, sidecar.entries)
    const result = await new Memory().fetchMemoryMessages(executionContext(), INPUTS)
    expect(result[0].content).toBe('{{TOKEN}}')
    expect(mocks.logger.error).not.toHaveBeenCalled()
  })

  it.each(['append', 'seed'] as const)('binds %s messages after removing files', async (mode) => {
    const service = new Memory()
    const writes = service as unknown as MemoryWrites
    const append = vi.spyOn(writes, 'appendMessage').mockResolvedValue(undefined)
    const seed = vi.spyOn(writes, 'seedMemoryRecord').mockResolvedValue(undefined)
    const registry = new ResolvedSecretTraceRegistry(
      [{ name: 'TOKEN', plaintext: SECRET, encryptedValue: 'ciphertext' }],
      SCOPE
    )
    registry.recordResolved('TOKEN', SECRET)
    const message = {
      role: 'user',
      content: SECRET,
      files: [{ id: 'file-1', name: 'document.txt' }],
    } as Message
    if (mode === 'append') await service.appendToMemory(executionContext(registry), INPUTS, message)
    else await service.seedMemory(executionContext(registry), INPUTS, [message])

    const stored = mode === 'append' ? [append.mock.calls[0][2]] : seed.mock.calls[0][2]
    const provenance = mode === 'append' ? append.mock.calls[0][3] : seed.mock.calls[0][3]
    expect(stored).toEqual([{ role: 'user', content: SECRET }])
    expect(provenance).toMatchObject({
      status: 'exact',
      entries: [{ sourceValueHash: hashDurableSecretProvenanceValue(stored[0]) }],
    })
    if (provenance?.status !== 'exact') throw new Error('Expected exact provenance')
    queueStoredMemory(stored, provenance.entries)
    expect((await service.fetchMemoryMessages(executionContext(), INPUTS))[0].content).toBe(
      '{{TOKEN}}'
    )
    expect(mocks.logger.error).not.toHaveBeenCalled()
  })

  it.each(['unbound', 'before-file-sanitization'] as const)(
    'redacts historical %s entries without refusing the run or exposing telemetry values',
    async (binding) => {
      const message: Message = { role: 'user', content: SECRET }
      queueStoredMemory(
        [message],
        [
          {
            ...ENTRY,
            ...(binding === 'before-file-sanitization'
              ? { sourceValueHash: hashDurableSecretProvenanceValue({ ...message, files: [] }) }
              : {}),
          },
        ]
      )
      const context = executionContext()
      expect((await new Memory().fetchMemoryMessages(context, INPUTS))[0].content).toBe('{{TOKEN}}')
      expect(context.resolvedSecretTraceRegistry?.isComplete()).toBe(true)
      expect(mocks.report).not.toHaveBeenCalled()
      expect(mocks.logger.error).toHaveBeenCalledExactlyOnceWith(
        'Validated historical memory secret provenance',
        {
          surface: 'memory',
          cause: binding === 'unbound' ? 'unbound-message-entry' : 'unmatched-message-hash',
          entryCount: 1,
          workspaceId: SCOPE.workspaceId,
        }
      )
      const telemetry = JSON.stringify(mocks.logger.error.mock.calls)
      expect(telemetry).not.toContain(SECRET)
      expect(telemetry).not.toContain(ENTRY.encryptedValue)
      expect(telemetry).not.toContain(ENTRY.name)
    }
  )

  it('does not reactivate a known omitted message while recovering an unrelated old entry', async () => {
    const oldMessage: Message = { role: 'user', content: SECRET }
    const retained: Message = { role: 'assistant', content: SECRET }
    queueStoredMemory(
      [oldMessage, retained],
      [
        { ...ENTRY, sourceValueHash: hashDurableSecretProvenanceValue(oldMessage) },
        { ...ENTRY, name: 'OTHER', encryptedValue: 'other-ciphertext' },
      ]
    )
    mocks.decrypt.mockImplementation(async (ciphertext: string) => ({
      decrypted: ciphertext === 'other-ciphertext' ? 'unrelated-value' : SECRET,
    }))
    const result = await new Memory().fetchMemoryMessages(executionContext(), {
      ...INPUTS,
      memoryType: 'sliding_window',
      slidingWindowSize: '1',
    })
    expect(result).toEqual([retained])
    expect(mocks.decrypt).not.toHaveBeenCalledWith(ENTRY.encryptedValue)
  })

  it('keeps legacy records readable without claiming unrelated current secrets', async () => {
    queueTableRows(memory, [
      { data: [{ role: 'user', content: SECRET }], secretProvenanceVersion: null },
    ])
    const result = await new Memory().fetchMemoryMessages(executionContext(), INPUTS)
    expect(result[0].content).toBe(SECRET)
    expect(mocks.logger.error).not.toHaveBeenCalled()
    expect(mocks.decrypt).not.toHaveBeenCalled()
  })

  it('retains foreign-source anonymity when recovering historical bindings', async () => {
    queueStoredMemory(
      [{ role: 'user', content: SECRET }],
      [{ ...ENTRY, sourceUserId: 'other-user', sourceWorkspaceId: 'other-workspace' }]
    )
    const result = await new Memory().fetchMemoryMessages(executionContext(), INPUTS)
    expect(result[0].content).not.toContain(SECRET)
    expect(result[0].content).not.toContain(ENTRY.name)
    expect(result[0].content).not.toContain('other-user')
  })

  it('preserves both original source identities when the same ciphertext is supplied twice', async () => {
    const message: Message = { role: 'user', content: SECRET }
    const foreignEntry = {
      ...ENTRY,
      name: 'FOREIGN_TOKEN',
      sourceUserId: 'other-user',
      sourceWorkspaceId: 'other-workspace',
    }
    const provenance = await bindMemorySecretProvenanceToMessages([message], {
      status: 'exact',
      entries: [ENTRY, foreignEntry],
    })
    expect(provenance).toEqual({
      status: 'exact',
      entries: expect.arrayContaining([
        { ...ENTRY, sourceValueHash: hashDurableSecretProvenanceValue(message) },
        { ...foreignEntry, sourceValueHash: hashDurableSecretProvenanceValue(message) },
      ]),
    })
    if (provenance.status !== 'exact') throw new Error('Expected exact provenance')
    expect(provenance.entries).toHaveLength(2)
  })

  it('retains more than ten thousand message bindings for one secret while selecting only the current window', async () => {
    const messages: Message[] = Array.from({ length: 10_001 }, (_, index) => ({
      role: 'user',
      content: `${SECRET} message-${index}`,
    }))
    const provenance = await bindMemorySecretProvenanceToMessages(messages, {
      status: 'exact',
      entries: [ENTRY, ENTRY],
    })
    if (provenance.status !== 'exact') throw new Error('Expected exact provenance')
    expect(provenance.entries).toHaveLength(messages.length)
    expect(new Set(provenance.entries.map((entry) => entry.encryptedValue))).toEqual(
      new Set([ENTRY.encryptedValue])
    )
    const selector = await createMemorySecretProvenanceSelector(provenance, messages)
    expect(selector.recoveredEntryCount).toBe(0)
    const selected = messages.slice(-2)
    expect(selector.select(selected, false)).toEqual({
      status: 'exact',
      entries: expect.arrayContaining(
        selected.map((message) => ({
          ...ENTRY,
          sourceValueHash: hashDurableSecretProvenanceValue(message),
        }))
      ),
    })
    const selection = selector.select(selected, false)
    if (selection.status !== 'exact') throw new Error('Expected exact selection')
    expect(selection.entries).toHaveLength(2)
    const readerRegistry = new ResolvedSecretTraceRegistry([], SCOPE)
    expect(
      await importDurableSecretProvenance(
        readerRegistry,
        selector.select(messages, false),
        messages,
        'memory'
      )
    ).toBe(true)
    expect(readerRegistry.exportProvenance().entries).toHaveLength(1)
    expect(readerRegistry.isComplete()).toBe(true)
    expect(mocks.logger.error).not.toHaveBeenCalled()
  })

  it('still rejects more than ten thousand distinct secrets', async () => {
    const provenance = await bindMemorySecretProvenanceToMessages(
      [{ role: 'user', content: SECRET }],
      {
        status: 'exact',
        entries: Array.from({ length: 10_001 }, (_, index) => ({
          ...ENTRY,
          encryptedValue: `ciphertext-${index}`,
        })),
      }
    )
    expect(provenance).toEqual({ status: 'unknown' })
    expect(mocks.decrypt).not.toHaveBeenCalled()
  })

  it('still rejects message bindings whose serialized sidecar exceeds eight MiB', async () => {
    const messages: Message[] = Array.from({ length: 8_000 }, (_, index) => ({
      role: 'user',
      content: `${SECRET} message-${index}`,
    }))
    const provenance = await bindMemorySecretProvenanceToMessages(messages, {
      status: 'exact',
      entries: [{ ...ENTRY, encryptedValue: 'ciphertext'.repeat(120) }],
    })
    expect(provenance).toEqual({ status: 'unknown' })
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Memory message secret provenance could not be bound',
      { surface: 'memory', cause: 'entries-unnormalizable' }
    )
  })

  it('recovers valid historical entries without newly refusing an unreadable old ciphertext', async () => {
    queueStoredMemory(
      [{ role: 'user', content: SECRET }],
      [ENTRY, { ...ENTRY, encryptedValue: 'corrupt-ciphertext' }]
    )
    mocks.decrypt.mockImplementation(async (ciphertext: string) => {
      if (ciphertext === 'corrupt-ciphertext') throw new Error(`Sensitive failure: ${SECRET}`)
      return { decrypted: SECRET }
    })
    const execution = executionContext()
    const result = await new Memory().fetchMemoryMessages(execution, INPUTS)
    expect(result[0].content).toBe('{{TOKEN}}')
    expect(execution.resolvedSecretTraceRegistry?.isComplete()).toBe(true)
    expect(mocks.decrypt).toHaveBeenCalledWith('corrupt-ciphertext', { logFailure: false })
    expect(mocks.report).not.toHaveBeenCalled()
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Historical memory secret provenance could not be recovered',
      {
        surface: 'memory',
        cause: 'legacy-entry-recovery-failed',
        entryCount: 1,
        workspaceId: SCOPE.workspaceId,
      }
    )
    const telemetry = JSON.stringify(mocks.logger.error.mock.calls)
    expect(telemetry).not.toContain(SECRET)
    expect(telemetry).not.toContain('corrupt-ciphertext')
  })

  it('keeps historical memory readable when optional recoveries exceed the combined matcher budget', async () => {
    const values = ['a', 'b', 'c', 'd', 'e'].map((character) => character.repeat(60_000))
    const content = values.join(' ')
    queueStoredMemory(
      [{ role: 'user', content }],
      values.map((_, index) => ({ ...ENTRY, encryptedValue: `large-cipher-${index}` }))
    )
    mocks.decrypt.mockImplementation(async (ciphertext: string) => ({
      decrypted: values[Number(ciphertext.replace('large-cipher-', ''))],
    }))
    const execution = executionContext()
    const result = await new Memory().fetchMemoryMessages(execution, INPUTS)
    expect(result[0].content).toBe(content)
    expect(execution.resolvedSecretTraceRegistry?.isComplete()).toBe(true)
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Historical memory secret provenance recovery was skipped',
      {
        surface: 'memory',
        cause: 'legacy-recovery-capacity-exceeded',
        entryCount: 5,
        workspaceId: SCOPE.workspaceId,
      }
    )
  })

  it('does not newly require a run registry for historical unbound memory', async () => {
    queueStoredMemory([{ role: 'user', content: SECRET }], [ENTRY])
    const result = await new Memory().fetchMemoryMessages(
      { workspaceId: SCOPE.workspaceId } as ExecutionContext,
      INPUTS
    )
    expect(result[0].content).toBe(SECRET)
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Historical memory secret provenance recovery was skipped',
      {
        surface: 'memory',
        cause: 'legacy-recovery-context-unavailable',
        entryCount: 1,
        workspaceId: SCOPE.workspaceId,
      }
    )
  })
})
