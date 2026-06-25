import { describe, expect, it } from 'vitest'
import {
  extractEmbeddedImageIds,
  extractEmbeddedImageKeys,
} from '@/lib/copilot/tools/server/files/embedded-image-refs'

const KEY = 'workspace/W1/1700000000000-deadbeefdeadbeef-photo.png'

describe('extractEmbeddedImageIds', () => {
  it('extracts unique ids from view-url and in-app-path embeds (wf_ and uuid)', () => {
    const a = 'wf_YwDXi8eWOkTxn0sbgChlB'
    const b = '4bdaf6c4-072e-464e-891d-b6af3b5fe2cc'
    const content = `![x](/api/files/view/${a}) ![y](/workspace/W1/files/${b}) ![dup](/api/files/view/${a})`
    expect(extractEmbeddedImageIds(content).sort()).toEqual([b, a].sort())
  })

  it('ignores serve-url, external, and plain content', () => {
    expect(
      extractEmbeddedImageIds(`![a](/api/files/serve/${encodeURIComponent(KEY)}) plain`)
    ).toEqual([])
  })

  it('caps the result at 50 ids', () => {
    const content = Array.from(
      { length: 60 },
      (_, i) => `/api/files/view/wf_${String(i).padStart(6, '0')}`
    ).join(' ')
    expect(extractEmbeddedImageIds(content)).toHaveLength(50)
  })
})

describe('extractEmbeddedImageKeys', () => {
  it('extracts decoded workspace keys from serve-url embeds (encoded + s3/blob prefixed)', () => {
    const content = `![a](/api/files/serve/${encodeURIComponent(KEY)}?context=workspace) ![b](/api/files/serve/s3/${encodeURIComponent(KEY)})`
    expect(extractEmbeddedImageKeys(content)).toEqual([KEY])
  })

  it('drops non-workspace keys (e.g. public profile pictures) and view-url embeds', () => {
    const content =
      '![a](/api/files/serve/profile-pictures%2Fu1%2Favatar.png) ![b](/api/files/view/wf_abc)'
    expect(extractEmbeddedImageKeys(content)).toEqual([])
  })
})
