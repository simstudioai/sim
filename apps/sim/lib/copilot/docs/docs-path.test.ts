/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { docsSourceCandidates, foldDocsIndexPath } from '@/lib/copilot/docs/docs-path'
import { DOCS_MANIFEST } from '@/lib/copilot/generated/docs-manifest'

describe('foldDocsIndexPath', () => {
  it('folds a section overview onto the section path', () => {
    expect(foldDocsIndexPath('workflows/index.mdx')).toBe('workflows.mdx')
    expect(foldDocsIndexPath('platform/enterprise/index.mdx')).toBe('platform/enterprise.mdx')
  })

  it('leaves a plain page untouched', () => {
    expect(foldDocsIndexPath('workflows/blocks/agent.mdx')).toBe('workflows/blocks/agent.mdx')
    expect(foldDocsIndexPath('agents.mdx')).toBe('agents.mdx')
  })

  it('does not fold a page merely named index', () => {
    expect(foldDocsIndexPath('index.mdx')).toBe('index.mdx')
  })
})

describe('docsSourceCandidates', () => {
  it('is the inverse of the fold — one candidate always reproduces the input', () => {
    for (const publicPath of DOCS_MANIFEST) {
      const candidates = docsSourceCandidates(publicPath)
      expect(candidates.map(foldDocsIndexPath)).toContain(publicPath)
    }
  })

  it('offers both on-disk layouts for a section path', () => {
    expect(docsSourceCandidates('workflows.mdx')).toEqual(['workflows.mdx', 'workflows/index.mdx'])
  })
})
