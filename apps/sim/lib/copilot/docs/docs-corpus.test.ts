/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSleep } = vi.hoisted(() => ({
  mockSleep: vi.fn(() => Promise.resolve()),
}))

vi.mock('@sim/utils/helpers', () => ({
  sleep: mockSleep,
}))

import {
  couldMatchDocsScope,
  DocsCorpusError,
  globDocs,
  grepDocs,
  isDocsPath,
  readDocsPage,
} from '@/lib/copilot/docs/docs-corpus'
import { DOCS_MANIFEST } from '@/lib/copilot/generated/docs-manifest'

const SAMPLE_PAGE = DOCS_MANIFEST.find((path) => path === 'workflows/blocks/agent.mdx')

function fetchResponse(status: number, content = '', headers: HeadersInit = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => content,
  }
}

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

  it('treats a trailing-slash pattern like the bare directory instead of matching nothing', () => {
    expect(globDocs('docs/')).toEqual(['docs'])
    expect(globDocs('docs/integrations/')).toEqual(['docs/integrations'])
  })
})

describe('readDocsPage', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    mockSleep.mockReset()
    mockSleep.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches the manifest path verbatim from the docs site', async () => {
    expect(SAMPLE_PAGE).toBeDefined()
    fetchMock.mockResolvedValue(fetchResponse(200, '# Agent\n\nbody'))

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

  it('surfaces a docs-site outage as a retryable error after exhausting retries', async () => {
    fetchMock.mockResolvedValue(fetchResponse(502))
    await expect(readDocsPage(`docs/${SAMPLE_PAGE}`)).rejects.toThrow(/could not be reached/)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('treats a network failure as retryable', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'))
    await expect(readDocsPage(`docs/${SAMPLE_PAGE}`)).rejects.toThrow(/could not be reached/)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('recovers when a transient failure clears on retry', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValue(fetchResponse(200, '# Agent\n\nbody'))

    const page = await readDocsPage(`docs/${SAMPLE_PAGE}`)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(page).toEqual({ content: '# Agent\n\nbody', totalLines: 3 })
  })

  it('reports a page the site no longer serves as permanent, without retrying', async () => {
    fetchMock.mockResolvedValue(fetchResponse(404))
    const error = await readDocsPage(`docs/${SAMPLE_PAGE}`).catch((e) => e)
    expect(error).toBeInstanceOf(DocsCorpusError)
    expect(error.message).toMatch(/does not serve it/)
    expect(error.message).toMatch(/retrying will not help/)
    expect(error.message).not.toMatch(/could not be reached/)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('honors Retry-After while retrying a 429 response', async () => {
    fetchMock.mockResolvedValue(fetchResponse(429, '', { 'Retry-After': '7' }))
    await expect(readDocsPage(`docs/${SAMPLE_PAGE}`)).rejects.toThrow(/could not be reached/)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(mockSleep).toHaveBeenNthCalledWith(1, 7_000)
    expect(mockSleep).toHaveBeenNthCalledWith(2, 7_000)
  })

  it('treats 408 as retryable rather than a missing page', async () => {
    fetchMock.mockResolvedValue(fetchResponse(408))
    await expect(readDocsPage(`docs/${SAMPLE_PAGE}`)).rejects.toThrow(/could not be reached/)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('aborts an in-flight fetch without retrying', async () => {
    const controller = new AbortController()
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })

    const request = readDocsPage(`docs/${SAMPLE_PAGE}`, controller.signal)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    controller.abort(new Error('user stopped docs read'))

    await expect(request).rejects.toThrow('user stopped docs read')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(mockSleep).not.toHaveBeenCalled()
  })

  it('aborts retry backoff before starting another fetch', async () => {
    const controller = new AbortController()
    fetchMock.mockResolvedValue(fetchResponse(502))
    mockSleep.mockImplementationOnce(() => new Promise<void>(() => {}))

    const request = readDocsPage(`docs/${SAMPLE_PAGE}`, controller.signal)
    await vi.waitFor(() => expect(mockSleep).toHaveBeenCalledOnce())
    controller.abort(new Error('user stopped docs retry'))

    await expect(request).rejects.toThrow('user stopped docs retry')
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

describe('grepDocs', () => {
  const fetchMock = vi.fn()
  const SECTION_DIR = 'docs/workflows/blocks'

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('greps exactly one page for a page path', async () => {
    fetchMock.mockResolvedValue(fetchResponse(200, 'intro line\nsystemPrompt matters\ntail'))

    const matches = await grepDocs(`docs/${SAMPLE_PAGE}`, 'systemPrompt')

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(matches).toEqual([
      { path: `docs/${SAMPLE_PAGE}`, line: 2, content: 'systemPrompt matters' },
    ])
  })

  it('rejects a directory without fetching any pages', async () => {
    await expect(grepDocs(SECTION_DIR, 'cron marker')).rejects.toThrow(
      /grep must target one docs page/
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a path that is neither a page nor a directory without fetching', async () => {
    await expect(grepDocs('docs/not-a-real-page.mdx', 'cron')).rejects.toThrow(/not a docs page/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
