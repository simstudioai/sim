/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  couldMatchDocsScope,
  DocsCorpusError,
  globDocs,
  grepDocsPage,
  isDocsPath,
  readDocsPage,
} from '@/lib/copilot/docs/docs-corpus'
import { DOCS_MANIFEST } from '@/lib/copilot/generated/docs-manifest'

const SAMPLE_PAGE = DOCS_MANIFEST.find((path) => path === 'workflows/blocks/agent.mdx')

describe('docs corpus scoping', () => {
  it('recognizes docs paths', () => {
    expect(isDocsPath('docs/workflows.mdx')).toBe(true)
    expect(isDocsPath('docs')).toBe(true)
    expect(isDocsPath('/docs/workflows.mdx')).toBe(true)
    expect(isDocsPath('workflows.mdx')).toBe(false)
    expect(isDocsPath('files/report.pdf')).toBe(false)
    expect(isDocsPath('docsomething/x')).toBe(false)
    expect(isDocsPath(undefined)).toBe(false)
  })

  it('is opt-in: only an explicit docs/ pattern can match', () => {
    expect(couldMatchDocsScope('docs/**')).toBe(true)
    expect(couldMatchDocsScope('docs/workflows/**')).toBe(true)
    expect(couldMatchDocsScope('**')).toBe(false)
    expect(couldMatchDocsScope('**/*.mdx')).toBe(false)
    expect(couldMatchDocsScope('*')).toBe(false)
    expect(couldMatchDocsScope(undefined)).toBe(false)
  })
})

describe('globDocs', () => {
  it('lists the whole corpus under docs/**', () => {
    const files = globDocs('docs/**')
    expect(files.length).toBeGreaterThan(DOCS_MANIFEST.length)
    expect(files).toContain('docs/workflows/blocks/agent.mdx')
    expect(files).toContain('docs/workflows/blocks')
  })

  it('scopes to a section', () => {
    const files = globDocs('docs/integrations/*.mdx')
    expect(files).toContain('docs/integrations/gmail.mdx')
    expect(files.every((path) => path.startsWith('docs/integrations/'))).toBe(true)
  })

  it('excludes academy and api-reference', () => {
    expect(globDocs('docs/academy/**')).toEqual([])
    expect(globDocs('docs/api-reference/**')).toEqual([])
  })

  it('maps section index pages onto their parent URL path', () => {
    expect(globDocs('docs/workflows.mdx')).toEqual(['docs/workflows.mdx'])
    expect(globDocs('docs/workflows/index.mdx')).toEqual([])
  })
})

describe('readDocsPage', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches the manifest path verbatim from the docs site', async () => {
    expect(SAMPLE_PAGE).toBeDefined()
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '# Agent\n\nbody' })

    const page = await readDocsPage(`docs/${SAMPLE_PAGE}`)

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe(`https://docs.sim.ai/${SAMPLE_PAGE}`)
    expect(page).toEqual({ content: '# Agent\n\nbody', totalLines: 3 })
  })

  it('rejects an unknown page without fetching', async () => {
    await expect(readDocsPage('docs/not-a-real-page.mdx')).rejects.toThrow(DocsCorpusError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('points a directory read at glob', async () => {
    await expect(readDocsPage('docs/workflows/blocks')).rejects.toThrow(/is a directory/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces a docs-site outage as a retryable error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, text: async () => '' })
    await expect(readDocsPage(`docs/${SAMPLE_PAGE}`)).rejects.toThrow(/temporarily unavailable/)
  })

  it('treats a network failure as retryable', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'))
    await expect(readDocsPage(`docs/${SAMPLE_PAGE}`)).rejects.toThrow(/temporarily unavailable/)
  })

  it('reports a page the site no longer serves as permanent, not retryable', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => '' })
    const error = await readDocsPage(`docs/${SAMPLE_PAGE}`).catch((e) => e)
    expect(error).toBeInstanceOf(DocsCorpusError)
    expect(error.message).toMatch(/does not serve it/)
    expect(error.message).toMatch(/retrying will not help/)
    expect(error.message).not.toMatch(/temporarily unavailable/)
  })

  it('still treats 429 as retryable rather than permanent', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => '' })
    await expect(readDocsPage(`docs/${SAMPLE_PAGE}`)).rejects.toThrow(/temporarily unavailable/)
  })
})

describe('grepDocsPage', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('greps exactly one page', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'intro line\nsystemPrompt matters\ntail',
    })

    const matches = await grepDocsPage(`docs/${SAMPLE_PAGE}`, 'systemPrompt')

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(matches).toEqual([
      { path: `docs/${SAMPLE_PAGE}`, line: 2, content: 'systemPrompt matters' },
    ])
  })

  it('refuses a multi-page scope so one grep is never hundreds of fetches', async () => {
    await expect(grepDocsPage('docs/', 'cron')).rejects.toThrow(/single page/)
    await expect(grepDocsPage('docs/workflows', 'cron')).rejects.toThrow(/single page/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
