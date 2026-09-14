/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { DefaultFileIcon, getDocumentIcon, ZipIcon } from '@/components/icons/document-icons'

describe('getDocumentIcon', () => {
  it('uses the zip icon for zip archives by extension or mime type', () => {
    expect(getDocumentIcon('', 'Package.ZIP')).toBe(ZipIcon)
    expect(getDocumentIcon('application/zip', 'archive')).toBe(ZipIcon)
    expect(getDocumentIcon('application/x-zip-compressed', 'archive')).toBe(ZipIcon)
    expect(getDocumentIcon('application/x-zip', 'archive')).toBe(ZipIcon)
  })

  it('ignores mime type casing and parameters', () => {
    expect(getDocumentIcon('APPLICATION/ZIP', 'archive')).toBe(ZipIcon)
    expect(getDocumentIcon('application/zip; charset=binary', 'archive')).toBe(ZipIcon)
  })

  it('falls back to the default icon for unknown types', () => {
    expect(getDocumentIcon('application/octet-stream', 'blob.bin')).toBe(DefaultFileIcon)
  })
})
