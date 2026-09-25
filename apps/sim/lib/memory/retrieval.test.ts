import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  artifact: vi.fn(),
  history: vi.fn(),
  redact: vi.fn(),
  prefix: vi.fn(),
}))
vi.mock('@/lib/memory/retrieval-prefix', () => ({ readMemoryRetrievalPrefix: mocks.prefix }))
vi.mock('@/lib/memory/artifacts', () => ({
  MAX_MEMORY_ARTIFACT_BYTES: 8 * 1024 * 1024,
  readMemoryArtifactByHandle: mocks.artifact,
}))
vi.mock('@/lib/memory/artifact-handle', () => ({ getMemoryArtifactHandle: () => 'b'.repeat(64) }))
vi.mock('@/lib/memory/conversation-store', () => ({ readConversationItems: mocks.history }))
vi.mock('@/lib/logs/execution/pii-redaction', () => ({ redactObjectStrings: mocks.redact }))

import { EXACT_EMPTY_DURABLE_SECRET_PROVENANCE } from '@/lib/execution/durable-secret-provenance'
import {
  MAX_MEMORY_RETRIEVAL_SCAN_ITEMS,
  MAX_MEMORY_RETRIEVAL_TEXT_BYTES,
  memoryRetrievalArgumentsSchema,
  type RetrieveMemoryInput,
  retrieveMemory,
} from '@/lib/memory/retrieval'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const artifactId = 'a'.repeat(64)
const input: RetrieveMemoryInput = {
  workspaceId: 'workspace-1',
  memoryId: 'original-memory',
  arguments: { target: 'artifact', artifactId },
  projection: {},
}

function resultArtifact(output: unknown) {
  return {
    invocationId: 'invocation-1',
    rawResponse: { success: true, output: { credential: 'RAW_PRIVATE_CANARY' } },
    modelResponse: { success: true, output },
    provenance: EXACT_EMPTY_DURABLE_SECRET_PROVENANCE,
    native: { private: 'NATIVE_CANARY' },
  }
}

function historyItem(sequence: number, content: string) {
  return {
    sequence,
    kind: 'exchange',
    data: { messages: [{ role: 'user', content }], encryptedNative: 'ENCRYPTED_PRIVATE_CANARY' },
    provenance: EXACT_EMPTY_DURABLE_SECRET_PROVENANCE,
  }
}

describe('bounded model memory retrieval', () => {
  beforeEach(() => {
    mocks.artifact.mockResolvedValue(resultArtifact({ visible: 'Retained result details' }))
    mocks.history.mockResolvedValue({ items: [] })
    mocks.prefix.mockResolvedValue({ status: 'missing' })
    mocks.redact.mockImplementation(async (value: unknown) => value)
  })

  it('returns model-safe result fields and never private replay/native/provenance fields', async () => {
    const result = await retrieveMemory(input)
    expect(result.text).toContain('Retained result details')
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE_CANARY|NATIVE_CANARY|rawResponse|provenance|native/
    )
    expect(mocks.artifact).toHaveBeenCalledWith(
      expect.objectContaining({
        memoryId: 'original-memory',
        workspaceId: 'workspace-1',
        artifactId,
      })
    )
  })

  it.each([
    { version: 1, kind: 'agent-turn-journal-payload', payload: resultArtifact({ leak: true }) },
    { rawResponse: { output: 'RAW_PRIVATE_CANARY' } },
    { encryptedNative: 'ENCRYPTED_PRIVATE_CANARY' },
    { ...resultArtifact({ visible: true }), provenance: { status: 'unknown' } },
  ])('rejects private or untrusted artifact shapes', async (artifact) => {
    mocks.artifact.mockResolvedValueOnce(artifact)
    await expect(retrieveMemory(input)).rejects.toThrow('unavailable for safe retrieval')
  })

  it('reapplies currently active secret projection before literal search and output', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-canary', encryptedValue: 'encrypted-token' },
    ])
    registry.recordResolved('TOKEN', 'secret-canary')
    mocks.artifact.mockResolvedValue(
      resultArtifact({ reflected: 'secret-canary', visible: 'public' })
    )
    const result = await retrieveMemory({
      ...input,
      projection: { resolvedSecretTraceRegistry: registry },
    })
    expect(result.text).not.toContain('secret-canary')
    expect(result.text).toContain('public')
    const search = await retrieveMemory({
      ...input,
      arguments: { ...input.arguments, query: 'secret-canary' },
      projection: { resolvedSecretTraceRegistry: registry },
    })
    expect(search.text).toBe('')
  })

  it('fails closed when current secret provenance is incomplete', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    registry.markIncomplete('test')
    await expect(
      retrieveMemory({ ...input, projection: { resolvedSecretTraceRegistry: registry } })
    ).rejects.toThrow('unavailable for safe retrieval')
  })

  it('applies current PII policy before returning output and propagates masking failures', async () => {
    mocks.artifact.mockResolvedValue(resultArtifact({ email: 'person@example.com' }))
    mocks.redact.mockResolvedValueOnce({ success: true, output: { email: '[EMAIL]' } })
    const projection = {
      piiBlockOutputRedaction: { enabled: true, entityTypes: ['EMAIL_ADDRESS'] },
    }
    const result = await retrieveMemory({ ...input, projection })
    expect(result.text).not.toContain('person@example.com')
    expect(mocks.redact).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ onFailure: 'throw' })
    )
    mocks.redact.mockRejectedValueOnce(new Error('masking unavailable'))
    await expect(retrieveMemory({ ...input, projection })).rejects.toThrow('masking unavailable')
  })

  it('paginates large multilingual artifacts without gaps and within the UTF-8 byte limit', async () => {
    const artifact = resultArtifact({ text: '😀大'.repeat(2500) })
    mocks.artifact.mockResolvedValue(artifact)
    const chunks: string[] = []
    let cursor: string | undefined
    do {
      const result = await retrieveMemory({ ...input, arguments: { ...input.arguments, cursor } })
      expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(MAX_MEMORY_RETRIEVAL_TEXT_BYTES)
      expect(result.text).not.toContain('\uFFFD')
      chunks.push(result.text)
      cursor = result.nextCursor
    } while (cursor)
    expect(chunks.join('')).toBe(JSON.stringify(artifact.modelResponse))
    expect(chunks.length).toBeGreaterThan(1)
  })

  it('keeps escape-heavy JSON tool responses below 8 KiB including cursor metadata', async () => {
    mocks.artifact.mockResolvedValue(resultArtifact({ text: '\\"\n'.repeat(7000) }))
    const result = await retrieveMemory(input)
    expect(result.nextCursor).toBeDefined()
    expect(Buffer.byteLength(JSON.stringify({ success: true, output: result }))).toBeLessThan(8192)
  })

  it('treats query regex syntax literally and uses Unicode-safe search offsets', async () => {
    mocks.artifact.mockResolvedValue(resultArtifact({ text: `${'İ'.repeat(300)} literal .* here` }))
    const result = await retrieveMemory({
      ...input,
      arguments: { ...input.arguments, query: '.*' },
    })
    expect(result.text).toContain('literal .* here')
    expect(result.text).not.toContain('success')
  })

  it('keeps a search excerpt start on a code-point boundary', async () => {
    mocks.artifact.mockResolvedValue(
      resultArtifact({ text: `${'x'.repeat(200)}😀${'y'.repeat(127)}needle` })
    )
    const result = await retrieveMemory({
      ...input,
      arguments: { ...input.arguments, query: 'needle' },
    })
    expect(result.text.startsWith('😀')).toBe(true)
    expect(result.text).toContain('needle')
    expect(Buffer.from(result.text, 'utf8').toString('utf8')).toBe(result.text)
  })

  it('binds cursors to original owner, target, query and current projected content', async () => {
    mocks.artifact.mockResolvedValue(resultArtifact({ text: 'x'.repeat(7000) }))
    const first = await retrieveMemory(input)
    expect(first.nextCursor).toBeDefined()
    const next = { ...input.arguments, cursor: first.nextCursor }
    await expect(
      retrieveMemory({ ...input, memoryId: 'recreated-memory', arguments: next })
    ).rejects.toThrow('Invalid memory cursor')
    await expect(retrieveMemory({ ...input, arguments: { ...next, query: 'x' } })).rejects.toThrow(
      'Invalid memory cursor'
    )
    mocks.artifact.mockResolvedValue(resultArtifact({ text: 'changed' }))
    await expect(retrieveMemory({ ...input, arguments: next })).rejects.toThrow(
      'projection changed'
    )
  })

  it('caps history scanning and returns a continuation for a page without matches', async () => {
    mocks.history.mockResolvedValue({
      items: Array.from({ length: MAX_MEMORY_RETRIEVAL_SCAN_ITEMS }, (_, index) =>
        historyItem(100 - index, 'unrelated')
      ),
      nextBeforeSequence: 91,
    })
    const args = { target: 'history' as const, query: 'needle' }
    const result = await retrieveMemory({ ...input, arguments: args })
    expect(result).toMatchObject({ text: '', scannedItems: 10, nextCursor: expect.any(String) })
    expect(mocks.history).toHaveBeenCalledWith({
      workspaceId: input.workspaceId,
      memoryId: input.memoryId,
      beforeSequence: undefined,
      limit: 10,
      continueAfterByteLimit: true,
    })
    mocks.history.mockResolvedValueOnce({ items: [historyItem(90, 'Found NeEdLe here')] })
    const next = await retrieveMemory({
      ...input,
      arguments: { ...args, cursor: result.nextCursor },
    })
    expect(next.text).toContain('Found NeEdLe here')
    expect(mocks.history).toHaveBeenLastCalledWith(expect.objectContaining({ beforeSequence: 91 }))
    expect(JSON.stringify(next)).not.toContain('ENCRYPTED_PRIVATE_CANARY')
  })

  it('reports an oversized item explicitly and never loops on its cursor', async () => {
    mocks.history.mockResolvedValueOnce({
      items: [],
      unavailableSequence: 2,
      nextBeforeSequence: 2,
    })
    const args = { target: 'history' as const, query: 'needle' }
    const first = await retrieveMemory({ ...input, arguments: args })
    expect(first).toMatchObject({ text: '', scannedItems: 1, nextCursor: expect.any(String) })
    expect(first.notice).toContain('History item 2 is not retrievable')
    expect(mocks.prefix).not.toHaveBeenCalled()
    const next = await retrieveMemory({
      ...input,
      arguments: { ...args, cursor: first.nextCursor },
    })
    expect(mocks.history).toHaveBeenLastCalledWith(expect.objectContaining({ beforeSequence: 2 }))
    expect(next.nextCursor).toBeUndefined()
    expect(mocks.prefix).toHaveBeenCalledOnce()
  })

  it('searches the frozen legacy prefix after exhausting appended records', async () => {
    mocks.history.mockResolvedValueOnce({ items: [historyItem(1, 'appended message')] })
    mocks.prefix.mockResolvedValue({
      status: 'available',
      provenance: EXACT_EMPTY_DURABLE_SECRET_PROVENANCE,
      messages: [
        { role: 'user', content: 'older frozen needle' },
        { role: 'assistant', content: 'later prefix entry' },
      ],
    })
    const result = await retrieveMemory({
      ...input,
      arguments: { target: 'history', query: 'needle' },
    })
    expect(result.text).toContain('older frozen needle')
    expect(result).toMatchObject({ prefixIndex: 0, scannedItems: 3 })
    expect(result.nextCursor).toBeUndefined()
    expect(mocks.prefix).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: input.workspaceId, memoryId: input.memoryId })
    )
  })

  it.each([
    { target: 'artifact', artifactId: '../private-key' },
    { target: 'artifact', artifactId, key: 'execution/other/secret' },
    { target: 'history', workspaceId: 'other-workspace' },
    { target: 'history', memoryId: 'other-memory' },
    { target: 'history', limit: 6001 },
    { target: 'history', query: 'x'.repeat(257) },
  ])('rejects model-provided authority and out-of-bounds arguments', (args) => {
    expect(memoryRetrievalArgumentsSchema.safeParse(args).success).toBe(false)
  })
})
