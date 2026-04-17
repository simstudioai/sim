/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/executor/types'
import type { VariableResolver } from '@/executor/variables/resolver'
import { resolveArrayInput } from './subflow-utils'

describe('resolveArrayInput', () => {
  const fakeCtx = {} as unknown as ExecutionContext

  it('returns arrays as-is', () => {
    expect(resolveArrayInput(fakeCtx, [1, 2, 3], null)).toEqual([1, 2, 3])
  })

  it('converts plain objects to entries', () => {
    expect(resolveArrayInput(fakeCtx, { a: 1, b: 2 }, null)).toEqual([
      ['a', 1],
      ['b', 2],
    ])
  })

  it('returns empty array when a pure reference resolves to null (skipped block)', () => {
    // `resolveSingleReference` returns `null` for a reference that points at a
    // block that exists in the workflow but did not execute on this path.
    // A loop/parallel over such a reference should run zero iterations rather
    // than fail the workflow.
    const resolver = {
      resolveSingleReference: vi.fn().mockReturnValue(null),
    } as unknown as VariableResolver

    const result = resolveArrayInput(fakeCtx, '<SkippedBlock.result.items>', resolver)

    expect(result).toEqual([])
    expect(resolver.resolveSingleReference).toHaveBeenCalled()
  })

  it('returns the array from a pure reference that resolved to an array', () => {
    const resolver = {
      resolveSingleReference: vi.fn().mockReturnValue([1, 2, 3]),
    } as unknown as VariableResolver

    expect(resolveArrayInput(fakeCtx, '<Block.items>', resolver)).toEqual([1, 2, 3])
  })

  it('converts resolved objects to entries', () => {
    const resolver = {
      resolveSingleReference: vi.fn().mockReturnValue({ x: 1, y: 2 }),
    } as unknown as VariableResolver

    expect(resolveArrayInput(fakeCtx, '<Block.obj>', resolver)).toEqual([
      ['x', 1],
      ['y', 2],
    ])
  })

  it('throws when a pure reference resolves to a non-array, non-object, non-null value', () => {
    const resolver = {
      resolveSingleReference: vi.fn().mockReturnValue(42),
    } as unknown as VariableResolver

    expect(() => resolveArrayInput(fakeCtx, '<Block.count>', resolver)).toThrow(
      /did not resolve to an array or object/
    )
  })

  it('throws when a pure reference resolves to undefined (unknown block)', () => {
    // `undefined` means the reference could not be matched to any block at
    // all (typo / deleted block). This must still fail loudly.
    const resolver = {
      resolveSingleReference: vi.fn().mockReturnValue(undefined),
    } as unknown as VariableResolver

    expect(() => resolveArrayInput(fakeCtx, '<Missing.items>', resolver)).toThrow(
      /did not resolve to an array or object/
    )
  })

  it('parses a JSON array string', () => {
    expect(resolveArrayInput(fakeCtx, '[1, 2, 3]', null)).toEqual([1, 2, 3])
  })

  it('throws on a string that is neither a reference nor valid JSON array/object', () => {
    expect(() => resolveArrayInput(fakeCtx, 'not json', null)).toThrow()
  })
})
