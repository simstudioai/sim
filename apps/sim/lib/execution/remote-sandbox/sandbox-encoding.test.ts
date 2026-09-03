/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { isBinarySandboxPath } from '@/lib/execution/remote-sandbox/sandbox-encoding'

describe('isBinarySandboxPath', () => {
  it('treats image, document, and archive extensions as binary regardless of case', () => {
    for (const path of [
      '/home/user/a.jpg',
      '/tmp/B.PNG',
      '/x/report.pdf',
      '/x/deck.pptx',
      '/x/data.xlsx',
      '/x/a.zip',
    ]) {
      expect(isBinarySandboxPath(path)).toBe(true)
    }
  })

  it('treats text formats and unknown extensions as text', () => {
    for (const path of [
      '/home/user/a.json',
      '/tmp/rows.csv',
      '/x/notes.md',
      '/x/script.py',
      '/x/noext',
      '/x/data.parquet',
    ]) {
      expect(isBinarySandboxPath(path)).toBe(false)
    }
  })
})
