/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { extractAdfText } from '@/tools/jira/utils'

describe('extractAdfText', () => {
  describe('block structure', () => {
    it('separates paragraphs with newlines instead of flattening them', () => {
      const doc = {
        type: 'doc',
        version: 1,
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph.' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph.' }] },
        ],
      }

      expect(extractAdfText(doc)).toBe('First paragraph.\nSecond paragraph.')
    })

    it('concatenates inline siblings without inserting spaces', () => {
      const paragraph = {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'mention', attrs: { id: 'acc-1', text: '@Alice' } },
          { type: 'text', text: ', welcome.' },
        ],
      }

      expect(extractAdfText(paragraph)).toBe('Hello @Alice, welcome.')
    })
  })

  describe('lists', () => {
    it('prefixes list items with a dash', () => {
      const list = {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alpha' }] }],
          },
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Beta' }] }],
          },
        ],
      }

      expect(extractAdfText(list)).toBe('- Alpha\n- Beta')
    })

    it('indents nested lists rather than running them onto one line', () => {
      const list = {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Parent' }] },
              {
                type: 'bulletList',
                content: [
                  {
                    type: 'listItem',
                    content: [
                      { type: 'paragraph', content: [{ type: 'text', text: 'Child one' }] },
                    ],
                  },
                  {
                    type: 'listItem',
                    content: [
                      { type: 'paragraph', content: [{ type: 'text', text: 'Child two' }] },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sibling' }] }],
          },
        ],
      }

      expect(extractAdfText(list)).toBe('- Parent\n  - Child one\n  - Child two\n- Sibling')
    })

    it('handles ordered lists the same way', () => {
      const list = {
        type: 'orderedList',
        attrs: { order: 1 },
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Step' }] }],
          },
        ],
      }

      expect(extractAdfText(list)).toBe('- Step')
    })
  })

  describe('tables', () => {
    it('keeps header and body cells on separate lines', () => {
      const table = {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableHeader',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Name' }] }],
              },
              {
                type: 'tableHeader',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Owner' }] }],
              },
            ],
          },
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Deploy' }] }],
              },
              {
                type: 'tableCell',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alice' }] }],
              },
            ],
          },
        ],
      }

      expect(extractAdfText(table)).toBe('Name\nOwner\nDeploy\nAlice')
    })
  })

  describe('text-bearing inline nodes', () => {
    it('extracts status attrs.text', () => {
      expect(
        extractAdfText({ type: 'status', attrs: { text: 'In Progress', color: 'yellow' } })
      ).toBe('In Progress')
    })

    it('extracts date attrs.timestamp verbatim', () => {
      expect(extractAdfText({ type: 'date', attrs: { timestamp: '1582152559' } })).toBe(
        '1582152559'
      )
    })

    it('extracts inlineCard attrs.url', () => {
      expect(
        extractAdfText({ type: 'inlineCard', attrs: { url: 'https://example.com/issue/1' } })
      ).toBe('https://example.com/issue/1')
    })

    it('extracts a paragraph mixing text, status, date and inlineCard', () => {
      const paragraph = {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Status ' },
          { type: 'status', attrs: { text: 'Done', color: 'green' } },
          { type: 'text', text: ' on ' },
          { type: 'date', attrs: { timestamp: '1582152559' } },
          { type: 'text', text: ' see ' },
          { type: 'inlineCard', attrs: { url: 'https://example.com/x' } },
        ],
      }

      expect(extractAdfText(paragraph)).toBe('Status Done on 1582152559 see https://example.com/x')
    })

    it('returns empty string for an inlineCard that only carries undocumented data', () => {
      expect(extractAdfText({ type: 'inlineCard', attrs: { data: { url: 'https://x' } } })).toBe('')
    })

    it('renders hardBreak as a newline', () => {
      const paragraph = {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'line one' },
          { type: 'hardBreak' },
          { type: 'text', text: 'line two' },
        ],
      }

      expect(extractAdfText(paragraph)).toBe('line one\nline two')
    })
  })

  describe('malformed and edge-case input', () => {
    it('returns null for falsy content', () => {
      expect(extractAdfText(null)).toBeNull()
      expect(extractAdfText(undefined)).toBeNull()
      expect(extractAdfText('')).toBeNull()
      expect(extractAdfText(0)).toBeNull()
    })

    it('passes plain strings through', () => {
      expect(extractAdfText('already plain')).toBe('already plain')
    })

    it('does not throw on nodes with missing or wrong-typed fields', () => {
      expect(extractAdfText({})).toBe('')
      expect(extractAdfText({ type: 'paragraph' })).toBe('')
      expect(extractAdfText({ type: 'paragraph', content: null })).toBe('')
      expect(extractAdfText({ type: 'text' })).toBe('')
      expect(extractAdfText({ type: 'status' })).toBe('')
      expect(extractAdfText({ type: 'date', attrs: { timestamp: { nope: true } } })).toBe('')
      expect(extractAdfText({ type: 'inlineCard', attrs: { url: 42 } })).toBe('')
      expect(extractAdfText([])).toBe('')
      expect(extractAdfText(123)).toBe('')
    })

    it('skips null and empty children without emitting blank lines', () => {
      const doc = {
        type: 'doc',
        content: [
          null,
          { type: 'paragraph', content: [{ type: 'text', text: 'Kept' }] },
          { type: 'rule' },
          { type: 'paragraph', content: [] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Also kept' }] },
        ],
      }

      expect(extractAdfText(doc)).toBe('Kept\nAlso kept')
    })

    it('treats an unknown node type with content as block-level', () => {
      const doc = {
        type: 'doc',
        content: [
          { type: 'someFutureBlock', content: [{ type: 'text', text: 'A' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'B' }] },
        ],
      }

      expect(extractAdfText(doc)).toBe('A\nB')
    })
  })
})
