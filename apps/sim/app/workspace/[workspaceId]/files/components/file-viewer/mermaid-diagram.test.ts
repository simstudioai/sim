import { describe, expect, it } from 'vitest'
import { looksLikeMermaid } from './mermaid-diagram'

describe('looksLikeMermaid', () => {
  it('rejects ordinary code that merely contains a keyword later', () => {
    expect(looksLikeMermaid('const graph = makeGraph()\nreturn graph')).toBe(false)
    expect(looksLikeMermaid('print("pie")')).toBe(false)
    expect(looksLikeMermaid('SELECT * FROM pies')).toBe(false)
    expect(looksLikeMermaid('')).toBe(false)
    expect(looksLikeMermaid('\n\n   \n')).toBe(false)
    expect(looksLikeMermaid('# flowchart of the system')).toBe(false)
    expect(looksLikeMermaid('  // graph helpers')).toBe(false)
  })

  it('requires a word boundary after the keyword', () => {
    expect(looksLikeMermaid('graphql query { user }')).toBe(false)
    expect(looksLikeMermaid('pieChart()')).toBe(false)
    expect(looksLikeMermaid('flowcharting()')).toBe(false)
    expect(looksLikeMermaid('ganttify')).toBe(false)
    expect(looksLikeMermaid('journeyman')).toBe(false)
  })
})
