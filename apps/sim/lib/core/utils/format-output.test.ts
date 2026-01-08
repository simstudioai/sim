import { describe, expect, it } from 'vitest'
import {
  formatOutputForDisplay,
  formatOutputForChat,
  formatOutputForWorkflow,
  formatOutputRaw,
  formatOutputSafe,
  isOutputSafe
} from './format-output'

describe('format-output utilities', () => {
  describe('formatOutputForDisplay', () => {
    // Basic types
    it('handles null and undefined', () => {
      expect(formatOutputForDisplay(null)).toBe('')
      expect(formatOutputForDisplay(undefined)).toBe('')
    })

    it('handles primitive types', () => {
      expect(formatOutputForDisplay('hello')).toBe('hello')
      expect(formatOutputForDisplay(123)).toBe('123')
      expect(formatOutputForDisplay(true)).toBe('true')
      expect(formatOutputForDisplay(false)).toBe('false')
      expect(formatOutputForDisplay(0)).toBe('0')
      expect(formatOutputForDisplay(BigInt(999))).toBe('999')
    })

    // Object with text property
    it('extracts text from objects with text property', () => {
      expect(formatOutputForDisplay({ text: 'Hello World', type: 'response' })).toBe('Hello World')
      expect(formatOutputForDisplay({ text: '  spaced  ', other: 'data' })).toBe('spaced')
    })

    // Nested objects
    it('handles deeply nested text properties', () => {
      const nested = {
        data: {
          response: {
            message: {
              content: 'Deep text'
            }
          }
        }
      }
      expect(formatOutputForDisplay(nested)).toBe('Deep text')
    })

    // Arrays
    it('handles arrays of text objects', () => {
      const arr = [
        { text: 'Line 1' },
        { text: 'Line 2' },
        { content: 'Line 3' }
      ]
      expect(formatOutputForDisplay(arr)).toBe('Line 1 Line 2 Line 3')
    })

    it('handles mixed arrays', () => {
      const mixed = [
        'String',
        { text: 'Object text' },
        123,
        null,
        { message: 'Message text' }
      ]
      expect(formatOutputForDisplay(mixed)).toBe('String Object text 123 Message text')
    })

    // Special objects
    it('handles Date objects', () => {
      const date = new Date('2024-01-01T00:00:00Z')
      expect(formatOutputForDisplay(date)).toBe('2024-01-01T00:00:00.000Z')
    })

    it('handles Error objects', () => {
      const error = new Error('Test error')
      expect(formatOutputForDisplay(error)).toBe('Test error')
    })

    it('handles RegExp objects', () => {
      const regex = /test.*pattern/gi
      expect(formatOutputForDisplay(regex)).toBe('/test.*pattern/gi')
    })

    // Circular references
    it('handles circular references', () => {
      const obj: any = { a: 1 }
      obj.self = obj
      const result = formatOutputForDisplay(obj, { mode: 'raw' })
      expect(result).toContain('[Circular]')
      expect(() => formatOutputForDisplay(obj, { mode: 'raw' })).not.toThrow()
    })

    // Large arrays
    it('handles large arrays gracefully', () => {
      const bigArray = new Array(2000).fill('item')
      const result = formatOutputForDisplay(bigArray)
      expect(result).toContain('[Large Array: 2000 items]')
    })

    // Binary data
    it('handles Buffer data', () => {
      const buffer = Buffer.from('Hello Buffer')
      expect(formatOutputForDisplay(buffer)).toBe('Hello Buffer')

      const binaryBuffer = Buffer.from([0xFF, 0xFE, 0x00, 0x01])
      expect(formatOutputForDisplay(binaryBuffer)).toBe('[Binary Data]')
    })

    // Truncation
    it('truncates long strings when specified', () => {
      const longText = 'x'.repeat(10000)
      const result = formatOutputForDisplay(longText, { maxLength: 100, truncate: true })
      expect(result.length).toBeLessThan(150)
      expect(result).toContain('... [truncated]')
    })

    // Whitespace handling
    it('preserves whitespace when requested', () => {
      const spaced = 'Line 1\n\nLine 2\t\tTabbed'
      expect(formatOutputForDisplay(spaced, { preserveWhitespace: true }))
        .toBe('Line 1\n\nLine 2\t\tTabbed')
      expect(formatOutputForDisplay(spaced, { preserveWhitespace: false }))
        .toBe('Line 1 Line 2 Tabbed')
    })

    // Mode-specific formatting
    it('formats correctly for different modes', () => {
      const obj = { someField: 'value', type: 'test' }

      const chatFormat = formatOutputForDisplay(obj, { mode: 'chat' })
      const workflowFormat = formatOutputForDisplay(obj, { mode: 'workflow' })
      const rawFormat = formatOutputForDisplay(obj, { mode: 'raw' })

      // Chat mode should show JSON for objects without text fields
      expect(chatFormat).toContain('someField')

      // Workflow mode should wrap in code blocks
      expect(workflowFormat).toMatch(/```json/)
      expect(workflowFormat).toContain('someField')

      // Raw mode should show plain JSON
      expect(rawFormat).toMatch(/"someField":\s*"value"/)
    })

    // Edge cases
    it('handles objects with toString method', () => {
      const customObj = {
        toString() {
          return 'Custom String'
        }
      }
      expect(formatOutputForDisplay(customObj)).toBe('Custom String')
    })

    it('handles undefined and function properties', () => {
      const obj = {
        func: () => console.log('test'),
        undef: undefined,
        sym: Symbol('test')
      }
      const result = formatOutputForDisplay(obj, { mode: 'raw' })
      expect(result).toContain('[Function]')
      expect(result).toContain('[undefined]')
      expect(result).toContain('[Symbol]')
    })
  })

  describe('specialized formatters', () => {
    it('formatOutputForChat limits length', () => {
      const longText = 'x'.repeat(10000)
      const result = formatOutputForChat(longText)
      expect(result.length).toBeLessThanOrEqual(5100) // 5000 + truncation message
    })

    it('formatOutputForWorkflow wraps in code block', () => {
      const obj = { test: 'data' }
      const result = formatOutputForWorkflow(obj)
      expect(result).toMatch(/^```json/)
      expect(result).toMatch(/```$/)
    })

    it('formatOutputRaw preserves everything', () => {
      const text = '  \n\t  spaced  \n\t  '
      const result = formatOutputRaw(text)
      expect(result).toBe(text)
    })
  })

  describe('security features', () => {
    it('detects unsafe content', () => {
      expect(isOutputSafe('<script>alert("xss")</script>')).toBe(false)
      expect(isOutputSafe('javascript:void(0)')).toBe(false)
      expect(isOutputSafe('<div onclick="alert(1)">')).toBe(false)
      expect(isOutputSafe('<iframe src="evil">')).toBe(false)
      expect(isOutputSafe('Normal text')).toBe(true)
    })

    it('escapes HTML in unsafe content', () => {
      const unsafe = '<script>alert("xss")</script>'
      const result = formatOutputSafe(unsafe)
      expect(result).not.toContain('<script>')
      expect(result).toContain('&lt;script')
      expect(result).toContain('&gt;')
    })

    it('leaves safe content unescaped', () => {
      const safe = 'Normal text with no HTML'
      const result = formatOutputSafe(safe)
      expect(result).toBe(safe)
    })
  })

  describe('error handling', () => {
    it('handles errors gracefully', () => {
      // Create object that throws on property access
      const evil = new Proxy({}, {
        get() {
          throw new Error('Evil object!')
        }
      })

      const result = formatOutputForDisplay(evil)
      expect(result).toContain('[')
      expect(() => formatOutputForDisplay(evil)).not.toThrow()
    })

    it('handles very deep recursion', () => {
      let deep: any = { text: 'Found it!' }
      for (let i = 0; i < 20; i++) {
        deep = { nested: deep }
      }

      const result = formatOutputForDisplay(deep)
      // Should stop at MAX_DEPTH but not crash
      expect(result).toBeTruthy()
      expect(() => formatOutputForDisplay(deep)).not.toThrow()
    })
  })

  describe('real-world LLM outputs', () => {
    it('handles OpenAI format', () => {
      const openAIResponse = {
        choices: [{
          message: {
            content: 'AI response here'
          }
        }]
      }
      expect(formatOutputForDisplay(openAIResponse)).toBe('AI response here')
    })

    it('handles Anthropic format', () => {
      const anthropicResponse = {
        content: [{
          text: 'Claude response'
        }]
      }
      expect(formatOutputForDisplay(anthropicResponse)).toBe('Claude response')
    })

    it('handles streaming chunks', () => {
      const chunk = {
        delta: {
          content: 'Streaming text'
        }
      }
      expect(formatOutputForDisplay(chunk)).toBe('Streaming text')
    })

    it('handles tool outputs', () => {
      const toolOutput = {
        result: {
          data: {
            output: 'Tool execution result'
          }
        }
      }
      expect(formatOutputForDisplay(toolOutput)).toBe('Tool execution result')
    })
  })
})