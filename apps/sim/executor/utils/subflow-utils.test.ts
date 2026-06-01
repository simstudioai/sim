/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cacheLargeValue, clearLargeValueCacheForTests } from '@/lib/execution/payloads/cache'
import {
  LARGE_ARRAY_MANIFEST_MARKER,
  LARGE_ARRAY_MANIFEST_VERSION,
} from '@/lib/execution/payloads/large-array-manifest-metadata'
import { LARGE_VALUE_REF_MARKER } from '@/lib/execution/payloads/large-value-ref'
import type { ExecutionContext } from '@/executor/types'
import { findEffectiveContainerId } from '@/executor/utils/subflow-utils'
import { resolveArrayInputAsync } from '@/executor/utils/subflow-utils.server'
import type { VariableResolver } from '@/executor/variables/resolver'

describe('resolveArrayInputAsync', () => {
  const fakeCtx = {
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    executionId: 'execution-1',
    userId: 'user-1',
  } as unknown as ExecutionContext

  beforeEach(() => {
    clearLargeValueCacheForTests()
  })

  function createManifest(items: unknown[]) {
    const json = JSON.stringify(items)
    const size = Buffer.byteLength(json, 'utf8')
    const id = 'lv_ABCDEFGHIJKL'
    cacheLargeValue(id, items, size, fakeCtx)

    return {
      __simLargeArrayManifest: true,
      version: LARGE_ARRAY_MANIFEST_VERSION,
      kind: 'array',
      totalCount: items.length,
      chunkCount: 1,
      byteSize: size,
      chunks: [
        {
          ref: {
            __simLargeValueRef: true,
            version: 1,
            id,
            kind: 'array',
            size,
            executionId: fakeCtx.executionId,
          },
          count: items.length,
          byteSize: size,
        },
      ],
      preview: items.slice(0, 3),
    }
  }

  it('returns arrays as-is', async () => {
    await expect(resolveArrayInputAsync(fakeCtx, [1, 2, 3], null)).resolves.toEqual([1, 2, 3])
  })

  it('converts plain objects to entries', async () => {
    await expect(resolveArrayInputAsync(fakeCtx, { a: 1, b: 2 }, null)).resolves.toEqual([
      ['a', 1],
      ['b', 2],
    ])
  })

  it('materializes large array manifests instead of iterating metadata entries', async () => {
    const items = [{ id: 1 }, { id: 2 }]
    const manifest = createManifest(items)

    await expect(resolveArrayInputAsync(fakeCtx, manifest, null)).resolves.toEqual(items)
  })

  it('records exact nested keys discovered while materializing collection values', async () => {
    const ctx = {
      ...fakeCtx,
      largeValueKeys: [] as string[],
      fileKeys: [] as string[],
    } as ExecutionContext
    const nestedRef = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_MNOPQRSTUVWX',
      kind: 'object',
      size: 12,
      key: 'execution/workspace-1/workflow-1/source-execution/large-value-lv_MNOPQRSTUVWX.json',
      executionId: 'source-execution',
    }
    const file = {
      id: 'file-1',
      name: 'nested.txt',
      key: 'execution/workspace-1/workflow-1/source-execution/nested.txt',
      url: '/api/files/serve/execution/workspace-1/workflow-1/source-execution/nested.txt?context=execution',
      size: 5,
      type: 'text/plain',
      context: 'execution',
    }
    const items = [{ nestedRef, file }]
    const manifest = createManifest(items)

    await expect(resolveArrayInputAsync(ctx, manifest, null)).resolves.toEqual(items)

    expect(ctx.largeValueKeys).toEqual([nestedRef.key])
    expect(ctx.fileKeys).toEqual([file.key])
  })

  it('rejects invalid manifest-shaped collection inputs instead of iterating metadata', async () => {
    await expect(
      resolveArrayInputAsync(
        fakeCtx,
        {
          [LARGE_ARRAY_MANIFEST_MARKER]: true,
          version: LARGE_ARRAY_MANIFEST_VERSION,
          kind: 'array',
          totalCount: 1,
          chunkCount: 0,
          byteSize: 0,
          chunks: [],
          preview: [],
        },
        null
      )
    ).rejects.toThrow('Invalid large array manifest')
  })

  it('rejects invalid large-ref-shaped collection inputs instead of iterating metadata', async () => {
    await expect(
      resolveArrayInputAsync(
        fakeCtx,
        {
          [LARGE_VALUE_REF_MARKER]: true,
          version: 1,
          id: 'not-a-valid-large-value-id',
          kind: 'array',
          size: 1,
        },
        null
      )
    ).rejects.toThrow('Invalid large value ref')
  })

  it('returns empty array when a pure reference resolves to null (skipped block)', async () => {
    // `resolveSingleReference` returns `null` for a reference that points at a
    // block that exists in the workflow but did not execute on this path.
    // A loop/parallel over such a reference should run zero iterations rather
    // than fail the workflow.
    const resolver = {
      resolveSingleReference: vi.fn().mockResolvedValue(null),
    } as unknown as VariableResolver

    const result = await resolveArrayInputAsync(fakeCtx, '<SkippedBlock.result.items>', resolver)

    expect(result).toEqual([])
    expect(resolver.resolveSingleReference).toHaveBeenCalled()
  })

  it('returns the array from a pure reference that resolved to an array', async () => {
    const resolver = {
      resolveSingleReference: vi.fn().mockResolvedValue([1, 2, 3]),
    } as unknown as VariableResolver

    await expect(resolveArrayInputAsync(fakeCtx, '<Block.items>', resolver)).resolves.toEqual([
      1, 2, 3,
    ])
  })

  it('materializes a manifest returned by a pure reference', async () => {
    const items = [{ id: 1 }, { id: 2 }]
    const manifest = createManifest(items)
    const resolver = {
      resolveSingleReference: vi.fn().mockResolvedValue(manifest),
    } as unknown as VariableResolver

    await expect(resolveArrayInputAsync(fakeCtx, '<variable.issues>', resolver)).resolves.toEqual(
      items
    )
    expect(resolver.resolveSingleReference).toHaveBeenCalledWith(
      fakeCtx,
      '',
      '<variable.issues>',
      undefined,
      { allowLargeValueRefs: true }
    )
  })

  it('converts resolved objects to entries', async () => {
    const resolver = {
      resolveSingleReference: vi.fn().mockResolvedValue({ x: 1, y: 2 }),
    } as unknown as VariableResolver

    await expect(resolveArrayInputAsync(fakeCtx, '<Block.obj>', resolver)).resolves.toEqual([
      ['x', 1],
      ['y', 2],
    ])
  })

  it('throws when a pure reference resolves to a non-array, non-object, non-null value', async () => {
    const resolver = {
      resolveSingleReference: vi.fn().mockResolvedValue(42),
    } as unknown as VariableResolver

    await expect(resolveArrayInputAsync(fakeCtx, '<Block.count>', resolver)).rejects.toThrow(
      /did not resolve to an array or object/
    )
  })

  it('throws when a pure reference resolves to undefined (unknown block)', async () => {
    // `undefined` means the reference could not be matched to any block at
    // all (typo / deleted block). This must still fail loudly.
    const resolver = {
      resolveSingleReference: vi.fn().mockResolvedValue(undefined),
    } as unknown as VariableResolver

    await expect(resolveArrayInputAsync(fakeCtx, '<Missing.items>', resolver)).rejects.toThrow(
      /did not resolve to an array or object/
    )
  })

  it('parses a JSON array string', async () => {
    await expect(resolveArrayInputAsync(fakeCtx, '[1, 2, 3]', null)).resolves.toEqual([1, 2, 3])
  })

  it('throws on a string that is neither a reference nor valid JSON array/object', async () => {
    await expect(resolveArrayInputAsync(fakeCtx, 'not json', null)).rejects.toThrow()
  })
})

describe('findEffectiveContainerId', () => {
  it('finds pre-cloned nested subflow IDs with clone sequence suffixes', () => {
    const executionMap = new Map<string, unknown>([
      ['inner-parallel', {}],
      ['inner-parallel__obranch-2', {}],
      ['inner-parallel__clone3__obranch-2', {}],
    ])

    expect(
      findEffectiveContainerId('inner-parallel', 'leaf__clone7__obranch-2₍0₎', executionMap)
    ).toBe('inner-parallel__clone3__obranch-2')
  })
})
