/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { UserFile } from '@/executor/types'
import type { ToolDefinition } from '@/tools/types'

vi.mock('@/lib/internal/tool-operations/file-result.server', () => ({
  storeInternalToolFileResult: vi.fn(),
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({ downloadFileFromUrl: vi.fn() }))

import { FileToolProcessor } from '@/executor/utils/file-tool-processor'

const STORED_FILE: UserFile = {
  id: 'file-1',
  key: 'execution/file-1',
  url: '/api/files/serve/execution/file-1',
  name: 'notes.txt',
  type: 'text/plain',
  size: 5,
  base64: 'aGVsbG8=',
}
const TOOL: ToolDefinition = {
  id: 'alias-test',
  name: 'Alias Test',
  description: 'File aliases',
  version: '1.0.0',
  params: {},
  outputs: { file: { type: 'file', description: 'Stored file' } },
}
const CONTEXT = { workflowId: 'workflow-1', executionId: 'execution-1', workspaceId: 'workspace-1' }

describe('file output alias replacement', () => {
  it('handles deeply nested, small JSON metadata without recursive stack growth', async () => {
    const depth = 20_000
    const json = `${'{"child":'.repeat(depth)}null${'}'.repeat(depth)}`
    const metadata: Record<string, unknown> = JSON.parse(json)
    const result = await FileToolProcessor.processToolOutputs(
      { file: STORED_FILE, metadata },
      TOOL,
      CONTEXT
    )

    expect(json.length).toBeLessThan(1024 * 1024)
    expect(result.file).not.toHaveProperty('base64')
    expect(result.metadata === metadata).toBe(false)
    let cursor: unknown = result.metadata
    let actualDepth = 0
    while (cursor && typeof cursor === 'object' && 'child' in cursor) {
      actualDepth++
      cursor = cursor.child
    }
    expect(actualDepth).toBe(depth)
    expect(cursor).toBeNull()
  })

  it('preserves cycles and shared aliases while replacing every reference to the file', async () => {
    const shared = { file: STORED_FILE }
    const input: Record<string, unknown> = {
      file: STORED_FILE,
      messages: [shared, shared],
    }
    input.self = input
    const result = await FileToolProcessor.processToolOutputs(input, TOOL, CONTEXT)
    expect(result.self).toBe(result)
    const messages = result.messages as Array<{ file: UserFile }>
    expect(messages[0]).toBe(messages[1])
    expect(messages[0]?.file).toBe(result.file)
    expect(result.file).not.toHaveProperty('base64')
    expect(STORED_FILE.base64).toBe('aGVsbG8=')
    expect(input.self).toBe(input)
  })

  it('keeps buffers, stored files, and non-plain objects as leaves', async () => {
    const buffer = Buffer.alloc(12 * 1024 * 1024)
    const date = new Date('2026-01-01')
    const existing = { ...STORED_FILE, id: 'existing-file', base64: undefined }
    const result = await FileToolProcessor.processToolOutputs(
      { file: STORED_FILE, metadata: { buffer, date, existing } },
      TOOL,
      CONTEXT
    )
    const metadata = result.metadata as Record<string, unknown>
    expect(metadata.buffer).toBe(buffer)
    expect(metadata.date).toBe(date)
    expect(metadata.existing).toBe(existing)
  })

  it('preserves null prototypes and own __proto__ keys without modifying prototypes', async () => {
    const metadata: Record<string, unknown> = Object.create(null)
    metadata.file = STORED_FILE
    const keys = JSON.parse('{"__proto__":{"file":null}}')
    keys.__proto__.file = STORED_FILE
    const result = await FileToolProcessor.processToolOutputs(
      { file: STORED_FILE, metadata, keys },
      TOOL,
      CONTEXT
    )
    expect(Object.getPrototypeOf(result.metadata)).toBeNull()
    const copiedKeys = result.keys as Record<string, unknown>
    expect(Object.getPrototypeOf(copiedKeys)).toBe(Object.prototype)
    expect(Object.hasOwn(copiedKeys, '__proto__')).toBe(true)
    expect((copiedKeys.__proto__ as Record<string, unknown>).file).toBe(result.file)
    expect({}).not.toHaveProperty('file')
  })
})
