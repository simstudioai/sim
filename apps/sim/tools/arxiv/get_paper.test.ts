import { describe, expect, it } from 'vitest'
import { getPaperTool } from '@/tools/arxiv/get_paper'

function requestedId(paperId: string): string | null {
  const url = getPaperTool.request.url
  if (typeof url !== 'function') throw new Error('get paper tool has no url builder')
  return new URL(url({ paperId })).searchParams.get('id_list')
}

describe('arXiv get paper ID parsing', () => {
  it.each([
    ['1706.03762', '1706.03762'],
    ['  1706.03762  ', '1706.03762'],
    ['hep-th/9901001', 'hep-th/9901001'],
    ['https://arxiv.org/abs/1706.03762', '1706.03762'],
    ['http://arxiv.org/abs/1706.03762v5', '1706.03762v5'],
    ['https://arxiv.org/pdf/1706.03762v2.pdf', '1706.03762v2'],
    ['https://arxiv.org/pdf/1706.03762v2', '1706.03762v2'],
    ['https://arxiv.org/abs/1706.03762?context=cs#abstract', '1706.03762'],
    ['https://arxiv.org/abs/hep-th/9901001', 'hep-th/9901001'],
    ['https://www.arxiv.org/abs/1706.03762', '1706.03762'],
    ['https://export.arxiv.org/abs/1706.03762', '1706.03762'],
    ['arxiv.org/abs/1706.03762', '1706.03762'],
    ['www.arxiv.org/pdf/1706.03762.pdf', '1706.03762'],
  ])('reads %s as %s', (input, expected) => {
    expect(requestedId(input)).toBe(expected)
  })

  it.each([
    'https://evil.com/?x=arxiv.org/abs/1234',
    'https://evil.com/arxiv.org/abs/1234',
    'https://notarxiv.org/abs/1234',
    'https://arxiv.org.evil.com/abs/1234',
  ])('does not unwrap %s as an arXiv link', (input) => {
    expect(requestedId(input)).not.toBe('1234')
  })
})
