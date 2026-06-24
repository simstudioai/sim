import { describe, expect, it } from 'vitest'
import {
  extractEmbeddedFileRef,
  extractEmbeddedFileRefs,
} from '@/lib/uploads/utils/embedded-image-ref'

const KEY = 'workspace/W1/1700000000000-deadbeefdeadbeef-photo.png'
const ENCODED = encodeURIComponent(KEY)

describe('extractEmbeddedFileRef', () => {
  it('parses serve-url embeds (encoded, raw, and s3/blob prefixed) to the workspace key', () => {
    expect(extractEmbeddedFileRef(`/api/files/serve/${ENCODED}?context=workspace`)).toEqual({
      key: KEY,
    })
    expect(extractEmbeddedFileRef(`/api/files/serve/s3/${ENCODED}`)).toEqual({ key: KEY })
    expect(extractEmbeddedFileRef(`/api/files/serve/blob/${ENCODED}`)).toEqual({ key: KEY })
  })

  it('parses view-url and in-app-path embeds to the file id', () => {
    expect(extractEmbeddedFileRef('/api/files/view/wf_YwDXi8eWOkTxn0sbgChlB')).toEqual({
      fileId: 'wf_YwDXi8eWOkTxn0sbgChlB',
    })
    expect(extractEmbeddedFileRef('/workspace/W1/files/wf_abc')).toEqual({ fileId: 'wf_abc' })
  })

  it('returns null for external, data, and non-workspace serve urls', () => {
    expect(extractEmbeddedFileRef('https://cdn.example.com/a.png')).toBeNull()
    expect(extractEmbeddedFileRef('data:image/png;base64,AAAA')).toBeNull()
    expect(extractEmbeddedFileRef('/api/files/serve/profile-pictures%2Fu1%2Favatar.png')).toBeNull()
  })
})

describe('extractEmbeddedFileRefs', () => {
  it('collects de-duplicated keys and ids from a document via the shared parser', () => {
    const content = `
      ![a](/api/files/serve/${ENCODED}?context=workspace)
      ![b](/api/files/view/wf_abc)
      ![c](/workspace/W1/files/4bdaf6c4-072e-464e-891d-b6af3b5fe2cc)
      ![dup](/api/files/serve/s3/${ENCODED})
      ![ext](https://cdn.example.com/x.png)
      ![pub](/api/files/serve/profile-pictures%2Fu1%2Favatar.png)
    `
    const { keys, ids } = extractEmbeddedFileRefs(content)
    expect(keys).toEqual([KEY])
    expect(ids.sort()).toEqual(['4bdaf6c4-072e-464e-891d-b6af3b5fe2cc', 'wf_abc'].sort())
  })

  it('caps keys and ids at 50 each', () => {
    const ids = Array.from(
      { length: 60 },
      (_, i) => `/api/files/view/wf_${String(i).padStart(6, '0')}`
    )
    expect(extractEmbeddedFileRefs(ids.join(' ')).ids).toHaveLength(50)
  })
})
