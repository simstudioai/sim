/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEncryptSecret, mockWriteWorkspaceFileByPath } = vi.hoisted(() => ({
  mockEncryptSecret: vi.fn(),
  mockWriteWorkspaceFileByPath: vi.fn(),
}))

vi.mock('@/lib/core/security/encryption', () => ({
  encryptSecret: mockEncryptSecret,
}))

vi.mock('@/lib/copilot/vfs/resource-writer', () => ({
  writeCopilotWorkspaceFileByPath: mockWriteWorkspaceFileByPath,
}))

vi.mock('@/lib/copilot/request/otel', () => ({
  withCopilotSpan: (
    _name: string,
    _attrs: Record<string, unknown> | undefined,
    fn: (span: unknown) => Promise<unknown>
  ) => fn({ setAttribute: vi.fn(), setAttributes: vi.fn(), addEvent: vi.fn() }),
}))

import { RunFunction } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  extractTabularData,
  maybeWriteOutputToFile,
  normalizeOutputWorkspaceFileName,
  serializeOutputForFile,
  unwrapFunctionExecuteOutput,
} from '@/lib/copilot/request/tools/files'
import type { ExecutionContext } from '@/lib/copilot/request/types'
import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/limits'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

describe('unwrapFunctionExecuteOutput', () => {
  it('unwraps the run_function envelope { result, stdout }', () => {
    expect(unwrapFunctionExecuteOutput({ result: 'name,age\nAlice,30', stdout: '' })).toBe(
      'name,age\nAlice,30'
    )
  })

  it('passes through objects that do not have both result + stdout', () => {
    const output = { data: { rows: [], totalCount: 0 } }
    expect(unwrapFunctionExecuteOutput(output)).toBe(output)
  })

  it('passes through strings and arrays untouched', () => {
    expect(unwrapFunctionExecuteOutput('hello')).toBe('hello')
    const arr: unknown[] = [{ a: 1 }]
    expect(unwrapFunctionExecuteOutput(arr)).toBe(arr)
  })
})

describe('serializeOutputForFile (csv)', () => {
  it('returns raw CSV text when run_function result is already a CSV string', () => {
    const output = {
      result: 'name,age\nAlice,30\nBob,40',
      stdout: '(2 rows)',
    }
    expect(serializeOutputForFile(output, 'csv')).toBe('name,age\nAlice,30\nBob,40')
  })

  it('converts a result array of objects into CSV', () => {
    const output = {
      result: [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 40 },
      ],
      stdout: '',
    }
    expect(serializeOutputForFile(output, 'csv')).toBe('name,age\nAlice,30\nBob,40')
  })

  it('returns the raw string when the non-envelope output is already a CSV string', () => {
    expect(serializeOutputForFile('a,b\n1,2', 'csv')).toBe('a,b\n1,2')
  })

  it('falls back to JSON.stringify when the payload is not tabular and not a string', () => {
    const output = { result: { foo: 'bar' }, stdout: '' }
    expect(serializeOutputForFile(output, 'csv')).toBe('{\n  "foo": "bar"\n}')
  })
})

describe('serializeOutputForFile (json / txt / md)', () => {
  it('unwraps the envelope for json format so the file contains only result', () => {
    const output = { result: { hello: 'world' }, stdout: 'log' }
    expect(serializeOutputForFile(output, 'json')).toBe('{\n  "hello": "world"\n}')
  })

  it('returns the string payload as-is for txt/md/html formats', () => {
    const output = { result: '# Report\n\nHello', stdout: '' }
    expect(serializeOutputForFile(output, 'md')).toBe('# Report\n\nHello')
    expect(serializeOutputForFile(output, 'txt')).toBe('# Report\n\nHello')
    expect(serializeOutputForFile(output, 'html')).toBe('# Report\n\nHello')
  })
})

describe('normalizeOutputWorkspaceFileName', () => {
  it('derives the leaf file name from nested, percent-encoded output paths', () => {
    expect(normalizeOutputWorkspaceFileName('files/My%20Folder/notes.md')).toBe('notes.md')
    expect(normalizeOutputWorkspaceFileName('files/My%20Folder/phase%201/implementation.md')).toBe(
      'implementation.md'
    )
  })

  it('still handles normal workspace file output paths', () => {
    expect(normalizeOutputWorkspaceFileName('files/Reports/output.csv')).toBe('output.csv')
  })
})

describe('maybeWriteOutputToFile', () => {
  function buildContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
    return {
      userId: 'user-1',
      workflowId: 'wf-1',
      workspaceId: 'workspace-1',
      toolCallId: 'tool-1',
      copilotToolExecution: true,
      userPermission: 'write',
      resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
      ...overrides,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockEncryptSecret.mockResolvedValue({ encrypted: 'encrypted-csv-representation', iv: 'iv' })
    mockWriteWorkspaceFileByPath.mockResolvedValue({
      id: 'file-1',
      name: 'report.csv',
      vfsPath: 'files/report.csv',
      mode: 'overwrite',
    })
  })

  it('denies a read-only principal without writing the file', async () => {
    const result = await maybeWriteOutputToFile(
      RunFunction.id,
      { outputs: { files: [{ path: 'files/report.csv', mode: 'overwrite' }] } },
      { success: true, output: { result: 'name,age\nAlice,30', stdout: '' } },
      buildContext({ userPermission: 'read' })
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('requires write access')
    expect(mockWriteWorkspaceFileByPath).not.toHaveBeenCalled()
  })

  it('does not deny a read-only principal when no workspace write occurs (sandbox export active)', async () => {
    const result = await maybeWriteOutputToFile(
      RunFunction.id,
      { outputs: { files: [{ path: 'files/report.csv', mode: 'overwrite' }] } },
      { success: true, output: { result: { files: [{ path: 'report.csv' }] }, stdout: '' } },
      buildContext({ userPermission: 'read' })
    )

    expect(result.success).toBe(true)
    expect(mockWriteWorkspaceFileByPath).not.toHaveBeenCalled()
  })

  it('writes the output file for a write principal', async () => {
    const result = await maybeWriteOutputToFile(
      RunFunction.id,
      { outputs: { files: [{ path: 'files/report.csv', mode: 'overwrite' }] } },
      { success: true, output: { result: 'name,age\nAlice,30', stdout: '' } },
      buildContext()
    )

    expect(result.success).toBe(true)
    expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledTimes(1)
    expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ secretProvenance: { status: 'exact', entries: [] } })
    )
  })

  it('classifies large structured output from its serialized bytes instead of its object count', async () => {
    const registry = new ResolvedSecretTraceRegistry(
      [
        { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'encrypted-token' },
        {
          name: 'TOKEN_ALIAS',
          plaintext: 'secret-value',
          encryptedValue: 'encrypted-token-alias',
        },
      ],
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    registry.recordResolved('TOKEN', 'secret-value')
    registry.recordResolved('TOKEN_ALIAS', 'secret-value')
    const rows = Array.from({ length: 10_000 }, (_, index) => ({
      id: index,
      name: `row-${index}`,
      status: 'ready',
      enabled: true,
      token: index === 9_999 ? 'secret-value' : 'public-value',
    }))

    const result = await maybeWriteOutputToFile(
      RunFunction.id,
      { outputs: { files: [{ path: 'files/report.json', mode: 'overwrite' }] } },
      { success: true, output: { result: rows, stdout: '' } },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result.success).toBe(true)
    expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        secretProvenance: {
          status: 'exact',
          entries: [
            {
              name: 'TOKEN',
              encryptedValue: 'encrypted-token',
              sourceUserId: 'user-1',
              sourceWorkspaceId: 'workspace-1',
            },
            {
              name: 'TOKEN_ALIAS',
              encryptedValue: 'encrypted-token-alias',
              sourceUserId: 'user-1',
              sourceWorkspaceId: 'workspace-1',
            },
          ],
        },
      })
    )
  })

  it('writes raw output with unknown provenance when serialized output exceeds the scan budget', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'encrypted-token' },
    ])
    registry.recordResolved('TOKEN', 'secret-value')

    const result = await maybeWriteOutputToFile(
      RunFunction.id,
      { outputs: { files: [{ path: 'files/report.txt', mode: 'overwrite' }] } },
      {
        success: true,
        output: { result: 'x'.repeat(MAX_INLINE_MATERIALIZATION_BYTES + 1), stdout: '' },
      },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result.success).toBe(true)
    expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ secretProvenance: { status: 'unknown' } })
    )
  })

  it('persists raw bytes with exact provenance and leaves sibling literals unclassified', async () => {
    const parentRegistry = new ResolvedSecretTraceRegistry(
      [
        {
          name: 'OUTPUT_SECRET',
          plaintext: 'secret-value',
          encryptedValue: 'encrypted-output-secret',
        },
        {
          name: 'UNRELATED',
          plaintext: 'true',
          encryptedValue: 'encrypted-unrelated',
        },
      ],
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    parentRegistry.recordResolved('UNRELATED', 'true')
    const toolRegistry = parentRegistry.forkForInputPaths([])
    toolRegistry.recordResolved('OUTPUT_SECRET', 'secret-value')
    const runtimeOutput = {
      result: { token: 'secret-value', publicLabel: 'true', enabled: true },
      stdout: '',
    }

    const result = await maybeWriteOutputToFile(
      RunFunction.id,
      { outputs: { files: [{ path: 'files/report.json', mode: 'overwrite' }] } },
      { success: true, output: runtimeOutput },
      buildContext({ resolvedSecretTraceRegistry: toolRegistry })
    )

    expect(result.success).toBe(true)
    const write = mockWriteWorkspaceFileByPath.mock.calls[0][1]
    const persisted = write.buffer.toString('utf8')
    expect(JSON.parse(persisted)).toEqual({
      token: 'secret-value',
      publicLabel: 'true',
      enabled: true,
    })
    expect(write.secretProvenance).toEqual({
      status: 'exact',
      entries: [
        {
          name: 'OUTPUT_SECRET',
          encryptedValue: 'encrypted-output-secret',
          sourceUserId: 'user-1',
          sourceWorkspaceId: 'workspace-1',
        },
      ],
    })
    expect(runtimeOutput.result.token).toBe('secret-value')
  })

  it('tracks both logical and quote-escaped CSV representations', async () => {
    const secret = 'a"b\\c\nline'
    const registry = new ResolvedSecretTraceRegistry(
      [{ name: 'CSV_SECRET', plaintext: secret, encryptedValue: 'encrypted-csv-secret' }],
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    registry.recordResolved('CSV_SECRET', secret)

    const result = await maybeWriteOutputToFile(
      RunFunction.id,
      { outputs: { files: [{ path: 'files/report.csv', mode: 'overwrite' }] } },
      { success: true, output: { result: [{ value: secret }], stdout: '' } },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result.success).toBe(true)
    const write = mockWriteWorkspaceFileByPath.mock.calls[0][1]
    expect(write.buffer.toString('utf8')).toBe('value\n"a""b\\c\nline"')
    expect(write.secretProvenance).toEqual({
      status: 'exact',
      entries: [
        {
          name: 'CSV_SECRET',
          encryptedValue: 'encrypted-csv-representation',
          sourceUserId: 'user-1',
          sourceWorkspaceId: 'workspace-1',
        },
        {
          name: 'CSV_SECRET',
          encryptedValue: 'encrypted-csv-secret',
          sourceUserId: 'user-1',
          sourceWorkspaceId: 'workspace-1',
        },
      ],
    })
    expect(mockEncryptSecret).toHaveBeenCalledWith('a""b\\c\nline')
  })

  it('deduplicates repeated CSV quote transformations across the table', async () => {
    const secret = 'secret"value'
    const registry = new ResolvedSecretTraceRegistry(
      [{ name: 'CSV_SECRET', plaintext: secret, encryptedValue: 'encrypted-csv-secret' }],
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    registry.recordResolved('CSV_SECRET', secret)
    const rows = Array.from({ length: 10_000 }, () => ({ first: secret, second: secret }))

    const result = await maybeWriteOutputToFile(
      RunFunction.id,
      { outputs: { files: [{ path: 'files/report.csv', mode: 'overwrite' }] } },
      { success: true, output: { result: rows, stdout: '' } },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result.success).toBe(true)
    expect(mockEncryptSecret).toHaveBeenCalledTimes(1)
    expect(mockEncryptSecret).toHaveBeenCalledWith('secret""value')
    expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledTimes(1)
  })

  it('reuses serialized provenance for output files with the same format', async () => {
    const secret = 'aaaa"bbbb'
    const registry = new ResolvedSecretTraceRegistry(
      [{ name: 'CSV_SECRET', plaintext: secret, encryptedValue: 'encrypted-csv-secret' }],
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    registry.recordResolved('CSV_SECRET', secret)

    const result = await maybeWriteOutputToFile(
      RunFunction.id,
      {
        outputs: {
          files: [
            { path: 'files/one.csv', mode: 'overwrite' },
            { path: 'files/two.csv', mode: 'overwrite' },
          ],
        },
      },
      { success: true, output: { result: [{ value: secret }], stdout: '' } },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result.success).toBe(true)
    expect(mockEncryptSecret).toHaveBeenCalledTimes(1)
    expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledTimes(2)
  })

  it('preserves existing multi-file outputs beyond twenty declarations', async () => {
    const files = Array.from({ length: 21 }, (_, index) => ({
      path: `files/report-${index}.txt`,
      mode: 'overwrite' as const,
    }))

    const result = await maybeWriteOutputToFile(
      RunFunction.id,
      { outputs: { files } },
      { success: true, output: { result: 'content', stdout: '' } },
      buildContext()
    )

    expect(result.success).toBe(true)
    expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledTimes(21)
  })

  it('tracks a persisted legacy runtime alias', async () => {
    const registry = new ResolvedSecretTraceRegistry(
      [{ name: 'API_KEY', plaintext: 'secret-value', encryptedValue: 'encrypted-api-key' }],
      { userId: 'user-1', workspaceId: 'workspace-1' }
    )
    registry.recordResolved('API_KEY', 'secret-value')

    const result = await maybeWriteOutputToFile(
      RunFunction.id,
      { outputs: { files: [{ path: 'files/report.txt', mode: 'overwrite' }] } },
      { success: true, output: { result: '__var_API_KEY', stdout: '' } },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result.success).toBe(true)
    expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        buffer: Buffer.from('__var_API_KEY'),
        secretProvenance: {
          status: 'exact',
          entries: [
            {
              name: 'API_KEY',
              encryptedValue: 'encrypted-api-key',
              sourceUserId: 'user-1',
              sourceWorkspaceId: 'workspace-1',
            },
          ],
        },
      })
    )
  })

  it('preserves anonymous provenance without inventing a secret name', async () => {
    const registry = {
      exportCommittedProvenanceForValue: vi.fn().mockReturnValue({
        version: 1,
        complete: true,
        entries: [{ encryptedValue: 'encrypted-anonymous' }],
        scope: { userId: 'user-1', workspaceId: 'workspace-1' },
      }),
    } as unknown as ResolvedSecretTraceRegistry

    const result = await maybeWriteOutputToFile(
      RunFunction.id,
      { outputs: { files: [{ path: 'files/report.txt', mode: 'overwrite' }] } },
      { success: true, output: { result: 'anonymous-secret', stdout: '' } },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result.success).toBe(true)
    expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        secretProvenance: {
          status: 'exact',
          entries: [
            {
              encryptedValue: 'encrypted-anonymous',
              sourceUserId: 'user-1',
              sourceWorkspaceId: 'workspace-1',
            },
          ],
        },
      })
    )
  })

  it('preserves the secret source when a different actor writes within the same workspace', async () => {
    const registry = new ResolvedSecretTraceRegistry(
      [
        {
          name: 'OUTPUT_SECRET',
          plaintext: 'secret-value',
          encryptedValue: 'encrypted-output-secret',
        },
      ],
      { userId: 'workflow-owner', workspaceId: 'workspace-1' }
    )
    registry.recordResolved('OUTPUT_SECRET', 'secret-value')

    const result = await maybeWriteOutputToFile(
      RunFunction.id,
      { outputs: { files: [{ path: 'files/report.txt', mode: 'overwrite' }] } },
      { success: true, output: { result: 'secret-value', stdout: '' } },
      buildContext({ userId: 'billing-actor', resolvedSecretTraceRegistry: registry })
    )

    expect(result.success).toBe(true)
    expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'billing-actor' }),
      expect.objectContaining({
        secretProvenance: {
          status: 'exact',
          entries: [
            {
              name: 'OUTPUT_SECRET',
              encryptedValue: 'encrypted-output-secret',
              sourceUserId: 'workflow-owner',
              sourceWorkspaceId: 'workspace-1',
            },
          ],
        },
      })
    )
  })

  it('writes raw output with unknown provenance when the source scope differs', async () => {
    const registry = new ResolvedSecretTraceRegistry(
      [
        {
          name: 'OUTPUT_SECRET',
          plaintext: 'secret-value',
          encryptedValue: 'encrypted-output-secret',
        },
      ],
      { userId: 'workflow-owner', workspaceId: 'workspace-2' }
    )
    registry.recordResolved('OUTPUT_SECRET', 'secret-value')

    const result = await maybeWriteOutputToFile(
      RunFunction.id,
      { outputs: { files: [{ path: 'files/report.txt', mode: 'overwrite' }] } },
      { success: true, output: { result: 'secret-value', stdout: '' } },
      buildContext({ userId: 'billing-actor', resolvedSecretTraceRegistry: registry })
    )

    expect(result.success).toBe(true)
    expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ secretProvenance: { status: 'unknown' } })
    )
  })

  it('prepares every file provenance and marks unavailable lineage unknown', async () => {
    const exportCommittedProvenanceForValue = vi
      .fn()
      .mockReturnValueOnce({ version: 1, complete: true, entries: [] })
      .mockReturnValueOnce({ version: 1, complete: false, entries: [] })
    const registry = {
      exportCommittedProvenanceForValue,
    } as unknown as ResolvedSecretTraceRegistry

    const result = await maybeWriteOutputToFile(
      RunFunction.id,
      {
        outputs: {
          files: [
            { path: 'files/report.json', mode: 'overwrite' },
            { path: 'files/report.txt', mode: 'overwrite' },
          ],
        },
      },
      { success: true, output: { result: { token: 'value' }, stdout: '' } },
      buildContext({ resolvedSecretTraceRegistry: registry })
    )

    expect(result.success).toBe(true)
    expect(exportCommittedProvenanceForValue).toHaveBeenCalledTimes(2)
    expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledTimes(2)
    expect(mockWriteWorkspaceFileByPath.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ secretProvenance: { status: 'unknown' } })
    )
  })

  it('preserves legacy writes without a registry and marks their provenance unknown', async () => {
    const result = await maybeWriteOutputToFile(
      RunFunction.id,
      { outputs: { files: [{ path: 'files/report.json', mode: 'overwrite' }] } },
      { success: true, output: { result: { token: 'unknown' }, stdout: '' } },
      buildContext({ resolvedSecretTraceRegistry: undefined })
    )

    expect(result.success).toBe(true)
    expect(mockWriteWorkspaceFileByPath).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ secretProvenance: { status: 'unknown' } })
    )
  })

  it('fails loudly instead of silently skipping declared outputs when workspace context is missing', async () => {
    const result = await maybeWriteOutputToFile(
      RunFunction.id,
      { outputs: { files: [{ path: 'files/report.csv', mode: 'overwrite' }] } },
      { success: true, output: { result: 'name,age\nAlice,30', stdout: '' } },
      buildContext({ workspaceId: undefined })
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('NOT written')
    // The computed value survives so the model can use it without re-running.
    expect(result.output).toEqual({ result: 'name,age\nAlice,30', stdout: '' })
    expect(mockWriteWorkspaceFileByPath).not.toHaveBeenCalled()
  })

  it('still passes results through untouched when no outputs are declared, even without workspace context', async () => {
    const original = { success: true, output: { result: 42, stdout: '' } }
    const result = await maybeWriteOutputToFile(
      RunFunction.id,
      {},
      original,
      buildContext({ workspaceId: undefined })
    )

    expect(result).toBe(original)
    expect(mockWriteWorkspaceFileByPath).not.toHaveBeenCalled()
  })
})

describe('extractTabularData', () => {
  it('extracts rows directly from an array input', () => {
    expect(extractTabularData([{ a: 1 }, { a: 2 }])).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('does NOT unwrap run_function envelopes on its own (callers must pre-unwrap)', () => {
    // Caller is responsible for unwrapping { result, stdout } envelopes first.
    // Keeping that concern out of this function prevents a double unwrap when
    // the user's payload itself happens to have matching keys.
    expect(extractTabularData({ result: [{ a: 1 }], stdout: '' })).toBeNull()
  })

  it('extracts rows from the user_table query_rows shape', () => {
    const rows = extractTabularData({
      data: {
        rows: [
          { id: 'row_1', data: { name: 'Alice' } },
          { id: 'row_2', data: { name: 'Bob' } },
        ],
        totalCount: 2,
      },
    })
    expect(rows).toEqual([{ name: 'Alice' }, { name: 'Bob' }])
  })

  it('returns null for non-tabular inputs', () => {
    expect(extractTabularData('plain string')).toBeNull()
    expect(extractTabularData(null)).toBeNull()
    expect(extractTabularData({ foo: 'bar' })).toBeNull()
  })
})
