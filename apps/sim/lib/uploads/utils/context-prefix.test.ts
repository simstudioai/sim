import { describe, expect, it } from 'vitest'
import { inferContextFromKey, tryInferContextFromKey } from '@/lib/uploads/utils/file-utils'

describe('tryInferContextFromKey', () => {
  it('classifies a known prefix the same way the throwing form does', () => {
    for (const key of ['workspace/a/b.txt', 'execution/a/b/c/d.bin', 'kb/x', 'logs/y']) {
      expect(tryInferContextFromKey(key)).toBe(inferContextFromKey(key))
    }
  })

  it('answers null where the throwing form raises, so caller input cannot 500', () => {
    for (const key of ['', 'garbage', 'not-a-prefix/x.txt', '../escape']) {
      expect(tryInferContextFromKey(key)).toBeNull()
      expect(() => inferContextFromKey(key)).toThrow()
    }
  })
})
