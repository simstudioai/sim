/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/executor/types'
import type { VariableResolver } from '@/executor/variables/resolver'
import { findEffectiveContainerId, resolveArrayInputAsync } from './subflow-utils'

describe('resolveArrayInputAsync', () => {
  const fakeCtx = {} as unknown as ExecutionContext

  it('returns arrays as-is', async () => {
    await expect(resolveArrayInputAsync(fakeCtx, [1, 2, 3], null)).resolves.toEqual([1, 2, 3])
  })

  it('converts plain objects to entries', async () => {
    await expect(resolveArrayInputAsync(fakeCtx, { a: 1, b: 2 }, null)).resolves.toEqual([
      ['a', 1],
      ['b', 2],
    ])
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
