/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { generateUniqueExecutionFileKey } from '@/lib/uploads/contexts/execution/utils'
import { generateKnowledgeBaseFileKey } from '@/lib/uploads/contexts/knowledge-base/knowledge-base-file-manager'
import {
  buildStorageKeySegment,
  LOCAL_UPLOAD_METADATA_SUFFIX,
  MAX_STORAGE_KEY_NAME_BYTES,
} from '@/lib/uploads/core/storage-key'

/** Bytes in the last path component — what POSIX `NAME_MAX` actually bounds. */
function lastSegmentBytes(key: string): number {
  return Buffer.byteLength(key.slice(key.lastIndexOf('/') + 1), 'utf-8')
}

/** Longest name the workspace-file and knowledge-document contracts admit. */
const MAX_CONTRACT_NAME = `${'a'.repeat(251)}.txt`

/** POSIX `NAME_MAX` — what every derived component is ultimately measured against. */
const NAME_MAX = 255

describe('storage key segments', () => {
  it('keeps the name when it already fits, sanitizing only', () => {
    expect(buildStorageKeySegment('123-abc-', 'quarterly report.csv')).toBe(
      '123-abc-quarterly-report.csv'
    )
  })

  it('reserves the prefix out of the segment budget', () => {
    const segment = buildStorageKeySegment('123-abc-', MAX_CONTRACT_NAME)

    expect(Buffer.byteLength(segment, 'utf-8')).toBe(MAX_STORAGE_KEY_NAME_BYTES)
    expect(segment.startsWith('123-abc-')).toBe(true)
    expect(segment.endsWith('.txt')).toBe(true)
  })

  it('drops an extension that would consume the whole budget', () => {
    const segment = buildStorageKeySegment('', `name.${'x'.repeat(300)}`)

    expect(Buffer.byteLength(segment, 'utf-8')).toBe(MAX_STORAGE_KEY_NAME_BYTES)
  })

  it('leaves room for the sidecar local storage writes beside the object', () => {
    const segment = buildStorageKeySegment('123-abc-', MAX_CONTRACT_NAME)

    expect(
      Buffer.byteLength(`${segment}${LOCAL_UPLOAD_METADATA_SUFFIX}`, 'utf-8')
    ).toBeLessThanOrEqual(NAME_MAX)
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
  ])('bounds the last component of a %s key, sidecar included', (_label, generate) => {
    expect(lastSegmentBytes(generate()) + LOCAL_UPLOAD_METADATA_SUFFIX.length).toBeLessThanOrEqual(
      NAME_MAX
    )
  })
})
