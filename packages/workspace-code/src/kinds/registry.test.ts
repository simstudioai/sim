import { describe, expect, it } from 'vitest'
import { APPLY_ORDER } from '../kind'
import { isBlobKind, KIND_LAYOUTS } from './registry'

describe('BLOB_KIND_CODECS', () => {
  it('holds the codec of exactly the kinds whose layout has blob paths', () => {
    const withBlobPaths = APPLY_ORDER.filter((kind) => KIND_LAYOUTS[kind].isBlob !== undefined)

    expect(APPLY_ORDER.filter(isBlobKind)).toEqual(withBlobPaths)
  })
})
