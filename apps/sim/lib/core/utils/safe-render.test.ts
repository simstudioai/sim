/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { safeRenderValue } from '@/lib/core/utils/safe-render'

describe('safeRenderValue', () => {
  it('returns empty string for null', () => {
    expect(safeRenderValue(null)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(safeRenderValue(undefined)).toBe('')
  })

  it('returns string values unchanged', () => {
    expect(safeRenderValue('hello world')).toBe('hello world')
  })

  it('returns empty string for empty string input', () => {
    expect(safeRenderValue('')).toBe('')
  })

  it('converts numbers to string', () => {
    expect(safeRenderValue(42)).toBe('42')
    expect(safeRenderValue(0)).toBe('0')
    expect(safeRenderValue(-1.5)).toBe('-1.5')
  })

  it('converts booleans to string', () => {
    expect(safeRenderValue(true)).toBe('true')
    expect(safeRenderValue(false)).toBe('false')
  })

  it('extracts text from {text, type} content block objects', () => {
    expect(safeRenderValue({ text: 'Hello from AI', type: 'text' })).toBe('Hello from AI')
  })

  it('extracts text from {text} objects without type', () => {
    expect(safeRenderValue({ text: 'Some text' })).toBe('Some text')
  })

  it('joins text from arrays of content blocks', () => {
    const contentArray = [
      { text: 'Hello ', type: 'text' },
      { text: 'world', type: 'text' },
    ]
    expect(safeRenderValue(contentArray)).toBe('Hello world')
  })

  it('handles arrays with mixed content types', () => {
    const mixedArray = [
      { text: 'Text part', type: 'text' },
      { type: 'tool_use', id: '123', name: 'search' },
    ]
    const result = safeRenderValue(mixedArray)
    expect(result).toContain('Text part')
    expect(result).toContain('tool_use')
  })

  it('handles string arrays', () => {
    expect(safeRenderValue(['hello', 'world'])).toBe('helloworld')
  })

  it('JSON-stringifies plain objects without text property', () => {
    const obj = { key: 'value', nested: { a: 1 } }
    expect(safeRenderValue(obj)).toBe(JSON.stringify(obj, null, 2))
  })

  it('JSON-stringifies empty objects', () => {
    expect(safeRenderValue({})).toBe('{}')
  })

  it('handles empty arrays', () => {
    expect(safeRenderValue([])).toBe('[]')
  })

  it('does not extract text when text property is not a string', () => {
    const obj = { text: 42, type: 'number' }
    expect(safeRenderValue(obj)).toBe(JSON.stringify(obj, null, 2))
  })
})
