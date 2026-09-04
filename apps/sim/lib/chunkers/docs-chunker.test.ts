/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/embeddings', () => ({
  generateEmbeddings: vi.fn(async () => ({ embeddings: [] })),
}))

import { ChunkLimitExceededError } from '@/lib/chunkers/chunk-budget'
import { DocsChunker } from '@/lib/chunkers/docs-chunker'

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

  it('extracts items formatted across multiple lines', () => {
    const cleaned = cleanContent(
      [
        '<FAQ items={[',
        '  {',
        '    question: "Is SSO supported?",',
        '    answer: "Yes, on enterprise plans."',
        '  },',
        ']} />',
      ].join('\n')
    )

    expect(cleaned).toContain('Is SSO supported?')
    expect(cleaned).toContain('Yes, on enterprise plans.')
  })

  it('extracts single-quoted multiline items with trailing commas (session-policies shape)', () => {
    const cleaned = cleanContent(
      [
        '<FAQ',
        '  items={[',
        '    {',
        "      question: 'Do session policies apply to SSO sign-ins?',",
        '      answer:',
        "        'Yes. Sessions created through SSO follow the same limits.',",
        '    },',
        '    {',
        '      question: \'Does "Sign out all members" affect API keys?\',',
        "      answer: 'No. API keys are unaffected.',",
        '    },',
        '  ]}',
        '/>',
      ].join('\n')
    )

    expect(cleaned).toContain('Do session policies apply to SSO sign-ins?')
    expect(cleaned).toContain('Yes. Sessions created through SSO follow the same limits.')
    expect(cleaned).toContain('Does "Sign out all members" affect API keys?')
    expect(cleaned).toContain('No. API keys are unaffected.')
    expect(cleaned).not.toContain('items=')
  })

  it('unescapes escaped quotes in extracted strings', () => {
    const cleaned = cleanContent(
      '<FAQ items={[ { question: "What does \\"draft\\" mean?", answer: "An unsaved workflow." } ]} />'
    )

    expect(cleaned).toContain('What does "draft" mean?')
  })
})

describe('cleanContent scaffolding strips', () => {
  it('still strips imports, exports, comments, and code-ish brace expressions', () => {
    const cleaned = cleanContent(
      [
        'import { Callout } from "fumadocs-ui/components/callout"',
        'export const dynamic = "force-static"',
        '{/* editorial note */}',
        'Visible prose {props.title} continues here.',
        '<Callout>Inside text stays</Callout>',
      ].join('\n')
    )

    expect(cleaned).not.toContain('import')
    expect(cleaned).not.toContain('force-static')
    expect(cleaned).not.toContain('editorial note')
    expect(cleaned).not.toContain('props.title')
    expect(cleaned).toContain('Visible prose')
    expect(cleaned).toContain('Inside text stays')
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
