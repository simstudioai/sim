/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { extractFieldValues, traverseObjectPath } from '@/lib/core/utils/response-format'
import {
  LARGE_ARRAY_MANIFEST_VERSION,
  type LargeArrayManifest,
} from '@/lib/execution/payloads/large-array-manifest-metadata'

function createManifest(totalCount = 100_000): LargeArrayManifest {
  return {
    __simLargeArrayManifest: true,
    version: LARGE_ARRAY_MANIFEST_VERSION,
    kind: 'array',
    totalCount,
    chunkCount: 1,
    byteSize: 12 * 1024 * 1024,
    chunks: [
      {
        count: totalCount,
        byteSize: 12 * 1024 * 1024,
        ref: {
          __simLargeValueRef: true,
          version: 1,
          id: 'lv_ABCDEFGHIJKL',
          kind: 'array',
          size: 12 * 1024 * 1024,
          executionId: 'execution-1',
        },
      },
    ],
    preview: [{ key: 'SIM-0' }],
  }
}

describe('response format traversal', () => {
  it('returns whole large array manifest metadata without materializing chunks', () => {
    const manifest = createManifest()

    expect(traverseObjectPath({ output: { rows: manifest } }, 'output.rows')).toEqual(manifest)
  })

  it('returns manifest totalCount for length selections', () => {
    const manifest = createManifest()

    expect(traverseObjectPath({ output: { rows: manifest } }, 'output.rows.length')).toBe(100_000)
    expect(
      extractFieldValues({ output: { rows: manifest } }, ['block-1_output.rows.length'], 'block-1')
    ).toEqual({ 'output.rows.length': 100_000 })
  })

  it('does not perform indexed manifest reads in sync traversal', () => {
    const manifest = createManifest()

    expect(traverseObjectPath({ output: { rows: manifest } }, 'output.rows.0.key')).toBeUndefined()
  })
})
