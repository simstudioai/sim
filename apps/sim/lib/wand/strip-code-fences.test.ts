/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { shouldStripCodeFences, stripCodeFences } from '@/lib/wand/strip-code-fences'

describe('stripCodeFences', () => {
  it('leaves unfenced code untouched', () => {
    const code = 'const total = <a> + <b>;\nreturn total;'
    expect(stripCodeFences(code)).toBe(code)
  })

  it('unwraps a fully wrapped response', () => {
    expect(stripCodeFences('```python\nresult = <num1> + <num2>\nreturn result\n```')).toBe(
      'result = <num1> + <num2>\nreturn result'
    )
  })

  it('unwraps a response with no closing fence', () => {
    expect(stripCodeFences('```javascript\nconst x = 1;\nreturn x;')).toBe(
      'const x = 1;\nreturn x;'
    )
  })

  it('unwraps an untagged fence', () => {
    expect(stripCodeFences('```\nreturn 1;\n```')).toBe('return 1;')
  })

  it('tolerates leading whitespace before the opening fence', () => {
    expect(stripCodeFences('\n  ```python\nreturn 1\n```')).toBe('return 1')
  })

  it('preserves indentation inside the fence', () => {
    const fenced = '```python\nif <flag>:\n    return "yes"\nreturn "no"\n```'
    expect(stripCodeFences(fenced)).toBe('if <flag>:\n    return "yes"\nreturn "no"')
  })

  it('keeps every fenced region and drops prose between them', () => {
    const fenced = '```js\nconst a = 1;\n```\nThen send it:\n```js\nreturn a;\n```'
    expect(stripCodeFences(fenced)).toBe('const a = 1;\nreturn a;')
  })

  it('does not touch code that merely contains a fence later', () => {
    const code = 'const doc = `\n```json\n{"a":1}\n```\n`;\nreturn doc;'
    expect(stripCodeFences(code)).toBe(code)
  })

  it('returns the original when stripping would leave nothing', () => {
    const empty = '```python\n```'
    expect(stripCodeFences(empty)).toBe(empty)
  })

  it('is idempotent', () => {
    const once = stripCodeFences('```python\nreturn <x>\n```')
    expect(stripCodeFences(once)).toBe(once)
  })

  it('handles an empty string', () => {
    expect(stripCodeFences('')).toBe('')
  })
})

describe('shouldStripCodeFences', () => {
  it('strips for code and structured value types', () => {
    expect(shouldStripCodeFences('javascript-function-body')).toBe(true)
    expect(shouldStripCodeFences('custom-tool-schema')).toBe(true)
    expect(shouldStripCodeFences('json-object')).toBe(true)
    expect(shouldStripCodeFences('cron-expression')).toBe(true)
  })

  it('does not strip free-form prose', () => {
    expect(shouldStripCodeFences('system-prompt')).toBe(false)
  })

  it('does not strip when no generation type is declared', () => {
    expect(shouldStripCodeFences(undefined)).toBe(false)
    expect(shouldStripCodeFences('')).toBe(false)
  })

  it('does not strip an unrecognized type', () => {
    expect(shouldStripCodeFences('something-new')).toBe(false)
  })
})
