import { describe, expect, it } from 'vitest'
import { resolveCanvasCodePreview } from '@/lib/workflows/blocks/code-preview'
import type { SubBlockConfig } from '@/blocks/types'

const CODE_SUBBLOCK: SubBlockConfig = {
  id: 'code',
  type: 'code',
  language: 'javascript',
}

describe('resolveCanvasCodePreview', () => {
  it('uses the selected language when the block has a language field', () => {
    expect(
      resolveCanvasCodePreview(CODE_SUBBLOCK, 'print("hello")', { language: 'python' })
    ).toEqual({
      code: 'print("hello")',
      language: 'python',
    })
  })

  it('maps the stored shell language to the Prism bash grammar', () => {
    expect(
      resolveCanvasCodePreview({ ...CODE_SUBBLOCK, language: 'shell' }, 'echo hello', {})
    ).toEqual({
      code: 'echo hello',
      language: 'bash',
    })
  })

  it('falls back to the subblock language when the selected language is empty', () => {
    expect(resolveCanvasCodePreview(CODE_SUBBLOCK, 'return true', { language: '' })).toEqual({
      code: 'return true',
      language: 'javascript',
    })
  })

  it('does not preview non-code, password, empty, or non-string values', () => {
    expect(
      resolveCanvasCodePreview({ ...CODE_SUBBLOCK, type: 'short-input' }, 'hello', {})
    ).toBeUndefined()
    expect(
      resolveCanvasCodePreview({ ...CODE_SUBBLOCK, password: true }, 'secret', {})
    ).toBeUndefined()
    expect(resolveCanvasCodePreview(CODE_SUBBLOCK, '  ', {})).toBeUndefined()
    expect(resolveCanvasCodePreview(CODE_SUBBLOCK, { source: 'code' }, {})).toBeUndefined()
  })
})
