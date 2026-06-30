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

  it('detects Go, Rust, Java', () => {
    expect(detectLanguage('package main\n\nfunc main() {\n\tfmt.Println("hi")\n}')).toBe('go')
    expect(detectLanguage('type User struct {\n\tName string\n}')).toBe('go')
    expect(detectLanguage('fn main() {\n  let mut x = 1;\n  println!("{}", x);\n}')).toBe('rust')
    expect(detectLanguage('public class Box {\n  private int n;\n}')).toBe('java')
  })

  it('does not misread generics as HTML markup', () => {
    expect(detectLanguage('public class Box { private List<String> items; }')).toBe('java')
    expect(detectLanguage('let v: Vec<String> = Vec::new();\nfn f() {}')).toBe('rust')
    expect(detectLanguage('func Map[T any](s []T) {}\npackage x')).toBe('go')
  })
})
