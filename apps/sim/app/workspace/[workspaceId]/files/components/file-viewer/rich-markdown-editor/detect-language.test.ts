import { describe, expect, it } from 'vitest'
import { detectLanguage } from './detect-language'

describe('detectLanguage', () => {
  it('returns null for empty or unrecognizable content', () => {
    expect(detectLanguage('')).toBeNull()
    expect(detectLanguage('   \n  ')).toBeNull()
    expect(detectLanguage('just some prose words here')).toBeNull()
  })

  it('detects common languages from content shape', () => {
    expect(detectLanguage('{\n  "a": 1,\n  "b": [2, 3]\n}')).toBe('json')
    expect(detectLanguage('const x = 1\nfunction go() {}')).toBe('javascript')
    expect(detectLanguage('interface Foo { name: string }')).toBe('typescript')
    expect(detectLanguage('def main():\n    print("hi")')).toBe('python')
    expect(detectLanguage('SELECT id FROM users WHERE id = 1')).toBe('sql')
    expect(detectLanguage('#!/bin/bash\necho hello')).toBe('bash')
    expect(detectLanguage('<div class="x">hi</div>')).toBe('markup')
    expect(detectLanguage('.btn { color: red; padding: 4px }')).toBe('css')
  })

  it('does not misclassify a JS object as JSON', () => {
    expect(detectLanguage('const x = { a: 1 }')).toBe('javascript')
  })
})
