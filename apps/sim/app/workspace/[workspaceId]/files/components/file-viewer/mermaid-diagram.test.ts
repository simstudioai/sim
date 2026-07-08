/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { looksLikeMermaid } from './mermaid-diagram'

describe('looksLikeMermaid', () => {
  it('detects blocks whose first line opens with a diagram keyword', () => {
    expect(looksLikeMermaid('flowchart TD\n  A --> B')).toBe(true)
    expect(looksLikeMermaid('graph LR\n  A --> B')).toBe(true)
    expect(looksLikeMermaid('sequenceDiagram\n  Alice->>Bob: Hi')).toBe(true)
    expect(looksLikeMermaid('pie title NETFLIX\n  "A" : 90')).toBe(true)
    expect(looksLikeMermaid('stateDiagram-v2\n  [*] --> S')).toBe(true)
    expect(looksLikeMermaid('gantt\n  title A')).toBe(true)
  })

  it('detects the remaining diagram openers', () => {
    expect(looksLikeMermaid('classDiagram\n  Animal <|-- Duck')).toBe(true)
    expect(looksLikeMermaid('stateDiagram\n  [*] --> S')).toBe(true)
    expect(looksLikeMermaid('erDiagram\n  A ||--o{ B : has')).toBe(true)
    expect(looksLikeMermaid('journey\n  title My day')).toBe(true)
    expect(looksLikeMermaid('quadrantChart\n  title Reach')).toBe(true)
    expect(looksLikeMermaid('requirementDiagram')).toBe(true)
    expect(looksLikeMermaid('gitGraph')).toBe(true)
    expect(looksLikeMermaid('mindmap\n  root')).toBe(true)
    expect(looksLikeMermaid('timeline\n  title History')).toBe(true)
    expect(looksLikeMermaid('sankey-beta')).toBe(true)
    expect(looksLikeMermaid('xychart-beta')).toBe(true)
    expect(looksLikeMermaid('block-beta')).toBe(true)
    expect(looksLikeMermaid('packet-beta')).toBe(true)
    expect(looksLikeMermaid('kanban')).toBe(true)
    expect(looksLikeMermaid('architecture-beta')).toBe(true)
    expect(looksLikeMermaid('zenuml')).toBe(true)
    expect(looksLikeMermaid('C4Context\n  title System')).toBe(true)
    expect(looksLikeMermaid('C4Container')).toBe(true)
    expect(looksLikeMermaid('C4Component')).toBe(true)
    expect(looksLikeMermaid('C4Dynamic')).toBe(true)
    expect(looksLikeMermaid('C4Deployment')).toBe(true)
  })

  it('skips leading blank lines before the opener', () => {
    expect(looksLikeMermaid('\n\n  flowchart TD\n  A --> B')).toBe(true)
    expect(looksLikeMermaid('\n   \n\t\nsequenceDiagram\n  Alice->>Bob: Hi')).toBe(true)
  })

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
