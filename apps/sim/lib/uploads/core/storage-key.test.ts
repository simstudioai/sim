/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  generateLargeValuePayloadKey,
  generateUniqueExecutionFileKey,
} from '@/lib/uploads/contexts/execution/utils'
import { generateKnowledgeBaseFileKey } from '@/lib/uploads/contexts/knowledge-base/knowledge-base-file-manager'
import { buildStorageKeySegment } from '@/lib/uploads/core/storage-key'

/** Bytes in the last path component — what POSIX `NAME_MAX` actually bounds. */
function lastSegmentBytes(key: string): number {
  return Buffer.byteLength(key.slice(key.lastIndexOf('/') + 1), 'utf-8')
}

/** Longest name the workspace-file and knowledge-document contracts admit. */
const MAX_CONTRACT_NAME = `${'a'.repeat(251)}.txt`

describe('storage key segments', () => {
  it('keeps the name when it already fits, sanitizing only', () => {
    expect(buildStorageKeySegment('123-abc-', 'quarterly report.csv')).toBe(
      '123-abc-quarterly-report.csv'
    )
  })

  it('reserves the prefix out of the segment budget', () => {
    const segment = buildStorageKeySegment('123-abc-', MAX_CONTRACT_NAME)

    expect(Buffer.byteLength(segment, 'utf-8')).toBe(255)
    expect(segment.startsWith('123-abc-')).toBe(true)
    expect(segment.endsWith('.txt')).toBe(true)
  })

  it('drops an extension that would consume the whole budget', () => {
    const segment = buildStorageKeySegment('', `name.${'x'.repeat(300)}`)

    expect(Buffer.byteLength(segment, 'utf-8')).toBe(255)
  })

  it('refuses a prefix that leaves no room for a name', () => {
    expect(() => buildStorageKeySegment('p'.repeat(255), 'a.txt')).toThrow('no room')
  })

  it.each([
    ['knowledge base', () => generateKnowledgeBaseFileKey(MAX_CONTRACT_NAME)],
    [
      'execution file',
      () =>
        generateUniqueExecutionFileKey(
          { workspaceId: 'ws', workflowId: 'wf', executionId: 'ex' },
          MAX_CONTRACT_NAME
        ),
    ],
    [
      'large value payload',
      () =>
        generateLargeValuePayloadKey(
          { workspaceId: 'ws', workflowId: 'wf', executionId: 'ex' },
          'p'
        ),
    ],
  ])('bounds the last component of a %s key', (_label, generate) => {
    expect(lastSegmentBytes(generate())).toBeLessThanOrEqual(255)
  })
})
