import { describe, expect, it } from 'vitest'
import {
  extractEmbeddedFileRef,
  extractImgSrcs,
  storedFileId,
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
    expect(extractEmbeddedFileRef(`/api/files/serve/gcs/${ENCODED}`)).toEqual({ key: KEY })
  })

  it('parses view-url and in-app-path embeds to the file id', () => {
    expect(extractEmbeddedFileRef('/api/files/view/wf_YwDXi8eWOkTxn0sbgChlB')).toEqual({
      fileId: 'wf_YwDXi8eWOkTxn0sbgChlB',
    })
    expect(extractEmbeddedFileRef('/workspace/W1/files/wf_abc')).toEqual({ fileId: 'wf_abc' })
  })

  /**
   * The export bundler rewrites an embed by searching the document for the id it was handed, so a
   * decoded id would bundle the asset and leave the markdown pointing at the API URL.
   */
  it('returns the id as spelled in the src, so the export can find it again', () => {
    expect(extractEmbeddedFileRef('/api/files/view/wf%5Fabc')).toEqual({ fileId: 'wf%5Fabc' })
    expect(extractEmbeddedFileRef('/workspace/W1/files/wf%5Fabc')).toEqual({ fileId: 'wf%5Fabc' })
  })

  it('returns null for external, data, and non-workspace serve urls', () => {
    expect(extractEmbeddedFileRef('https://cdn.example.com/a.png')).toBeNull()
    expect(extractEmbeddedFileRef('data:image/png;base64,AAAA')).toBeNull()
    expect(extractEmbeddedFileRef('/api/files/serve/profile-pictures%2Fu1%2Favatar.png')).toBeNull()
  })
})

describe('storedFileId', () => {
  it('decodes a document-spelled id exactly once', () => {
    expect(storedFileId('wf%5Fabc')).toBe('wf_abc')
    expect(storedFileId('wf%255Fabc')).toBe('wf%5Fabc')
  })

  it('leaves malformed encodings unchanged', () => {
    expect(storedFileId('wf%5')).toBe('wf%5')
  })
})

describe('extractImgSrcs', () => {
  it('reads double-quoted, single-quoted, and unquoted srcs in document order', () => {
    expect(
      extractImgSrcs(
        `<img src="/a.png"><p>text</p><img src='/b.png'><img src=/c.png><img src="/a.png">`
      )
    ).toEqual(['/a.png', '/b.png', '/c.png', '/a.png'])
  })

  it('returns nothing for markup without images', () => {
    expect(extractImgSrcs('<p>hello</p>')).toEqual([])
    expect(extractImgSrcs('')).toEqual([])
  })
})
