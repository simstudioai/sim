import {
  knowledgeEmbeddingsMock,
  knowledgeEmbeddingsMockFns,
} from '@sim/testing/mocks/knowledge-embeddings.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/embeddings', () => knowledgeEmbeddingsMock)

import { mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { ChunkLimitExceededError } from '@/lib/chunkers/chunk-budget'
import { DocsChunker, resolveDocumentTitle } from '@/lib/chunkers/docs-chunker'

knowledgeEmbeddingsMockFns.mockGenerateEmbeddings.mockImplementation(async () => ({
  embeddings: [],
}))

function cleanContent(content: string): string {
  const chunker = new DocsChunker()
  return (chunker as unknown as { cleanContent(content: string): string }).cleanContent.call(
    chunker,
    content
  )
}

describe('cleanContent FAQ extraction', () => {
  it('keeps FAQ question/answer prose that the tag and brace strips would otherwise delete', () => {
    const cleaned = cleanContent(
      [
        'Some intro prose.',
        '',
        'import { FAQ } from "@/components/ui/faq"',
        '',
        '<FAQ items={[',
        '  { question: "What is the maximum file size for uploads?", answer: "The maximum file size for files processed during a workflow run is 20 MB." },',
        '  { question: "How are files passed between blocks internally?", answer: "Files are represented as standardized UserFile objects." },',
        ']} />',
      ].join('\n')
    )

    expect(cleaned).toContain('What is the maximum file size for uploads?')
    expect(cleaned).toContain('20 MB')
    expect(cleaned).toContain('standardized UserFile objects')
    expect(cleaned).toContain('Some intro prose.')
    expect(cleaned).not.toContain('items=')
    expect(cleaned).not.toContain('question:')
  })

  it('survives braces and angle-bracket tokens inside answer strings', () => {
    const cleaned = cleanContent(
      [
        '<FAQ items={[',
        `  { question: "What input formats work?", answer: "Use a data URI with the format 'data:{mime};base64,{data}' or a URL." },`,
        '  { question: "Do I extract base64 manually?", answer: "No. Pass the entire file reference (e.g., <gmail.attachments[0]>) and the block extracts what it needs." },',
        ']} />',
      ].join('\n')
    )

    // Brace placeholders keep their token text; the wrapper chars are dropped
    // so the later brace strip cannot punch holes in the sentence.
    expect(cleaned).toContain("'data:mime;base64,data'")
    // Angle brackets are dropped so the tag strip cannot re-eat the sentence.
    expect(cleaned).toContain('(e.g., gmail.attachments[0]) and the block extracts')
  })
})

describe('cleanContent keeps code intact', () => {
  it('leaves reference tokens inside fenced and inline code alone while stripping prose tags', () => {
    const chunker = new DocsChunker({ chunkSize: 500 })
    const cleaned = (chunker as unknown as { cleanContent: (c: string) => string }).cleanContent(
      [
        'Use <Callout>this</Callout> block. Reference `<start.input>` in code:',
        '```javascript',
        'return <start.input>.toLowerCase().includes({{ENV}})',
        '```',
      ].join('\n')
    )
    expect(cleaned).not.toContain('<Callout>')
    expect(cleaned).toContain('`<start.input>`')
    expect(cleaned).toContain('return <start.input>.toLowerCase().includes({{ENV}})')
  })
})

describe('DocsChunker output budget', () => {
  function splitContent(
    chunker: DocsChunker,
    content: string
  ): Promise<{ chunks: string[]; cleanedContent: string }> {
    return (
      chunker as unknown as {
        splitContent(content: string): Promise<{ chunks: string[]; cleanedContent: string }>
      }
    ).splitContent.call(chunker, content)
  }

  it('applies maxChunks after short intermediate chunks are filtered out', async () => {
    const chunker = new DocsChunker({ chunkSize: 1, chunkOverlap: 0, maxChunks: 1 })

    await expect(splitContent(chunker, 'a b c d')).resolves.toEqual({
      chunks: [],
      cleanedContent: 'a b c d',
    })
  })

  it('rejects when the final transformed output exceeds maxChunks', async () => {
    const chunker = new DocsChunker({ chunkSize: 30, chunkOverlap: 0, maxChunks: 1 })
    const content = `${'a'.repeat(110)}\n\n${'b'.repeat(110)}`

    await expect(splitContent(chunker, content)).rejects.toThrow(ChunkLimitExceededError)
  })

  it('enforces maxChunks after oversized chunks are split into final chunks', () => {
    const chunker = new DocsChunker({ chunkSize: 30, maxChunks: 1 })
    const enforceSizeLimit = (
      chunker as unknown as { enforceSizeLimit(chunks: string[]): string[] }
    ).enforceSizeLimit.bind(chunker)
    const longLine = 'a'.repeat(120)

    expect(() => enforceSizeLimit([`${longLine}\n${longLine}`])).toThrow(ChunkLimitExceededError)
  })
})

/**
 * `docs search --path docs/tables` answered results titled "Next": every page
 * ends on a nav link, so the last chunk sat under it and the indexer read the
 * link as its header. A title comes from the frontmatter, else the first `#`
 * heading, and never from a link-only line.
 */
describe('DocsChunker page title', () => {
  const NAV_LINK = '[Next](/docs/tables/workflow-columns)'
  const PARAGRAPH =
    'Tables store rows your workflows read and write. Columns are typed, and every write is validated against the schema before it lands, so a bad row never reaches a downstream block. '
  const _BODY = `# Tables

${PARAGRAPH.repeat(3)}

## Querying rows

Use the Table block to query, insert, or update rows from a workflow. ${PARAGRAPH.repeat(3)}

## ${NAV_LINK}

${NAV_LINK}
`

  async function _chunkPage(content: string) {
    const dir = await mkdtemp(join(tmpdir(), 'docs-chunker-'))
    const file = join(dir, 'tables.mdx')
    await writeFile(file, content)
    return new DocsChunker({ chunkSize: 100, chunkOverlap: 0 }).chunkMdxFile(file, dir)
  }

  it('never resolves a link-only heading as the title', () => {
    expect(
      resolveDocumentTitle({}, [{ level: 2, text: NAV_LINK, anchor: 'next', position: 0 }])
    ).toBeUndefined()
    expect(
      resolveDocumentTitle({ title: '  ' }, [
        { level: 2, text: 'Querying rows', anchor: 'querying-rows', position: 0 },
        { level: 1, text: 'Tables', anchor: 'tables', position: 10 },
      ])
    ).toBe('Tables')
  })
})
