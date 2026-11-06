import { partitionFiles } from '@scripts/duration-shards'
import { describe, expect, it } from 'vitest'

describe('duration-balanced file partitions', () => {
  it('keeps whole files and assigns every discovered file exactly once, including unmeasured files', () => {
    const files = ['a.spec.ts', 'b.spec.ts', 'new/nested.test.ts', 'unmeasured.spec.ts']
    const shards = partitionFiles(
      files,
      { 'a.spec.ts': 100, 'b.spec.ts': 1, 'deleted.spec.ts': 999 },
      3
    )
    expect(shards.flat().sort()).toEqual([...files].sort())
    expect(shards.every((shard) => shard.length > 0)).toBe(true)
  })

  it('separates long files instead of packing them into the same shard', () => {
    const weights = { a: 90, b: 20, c: 10, d: 100, e: 80 }
    const shards = partitionFiles(Object.keys(weights), weights, 3)
    const loads = shards.map((files) =>
      files.reduce((sum, file) => sum + weights[file as keyof typeof weights], 0)
    )
    expect(Math.max(...loads)).toBe(100)
  })

  it('gives all runners the same partition regardless of discovery order and equal weights', () => {
    const files = ['z', 'b', 'a', 'nested/c', 'x']
    expect(partitionFiles(files, {}, 3)).toEqual(partitionFiles([...files].reverse(), {}, 3))
  })

  it('preserves zero-duration files without placing every skipped file in one empty shard', () => {
    const shards = partitionFiles(['a', 'b', 'c'], { a: 0, b: 0, c: 0 }, 3)
    expect(shards.map((files) => files.length)).toEqual([1, 1, 1])
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid shard count %s',
    (count) => {
      expect(() => partitionFiles(['a'], {}, count)).toThrow('shard count')
    }
  )
})
