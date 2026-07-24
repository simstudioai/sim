/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/knowledge/embeddings', () => ({
  generateSearchEmbedding: vi.fn(),
}))

import { docsScopeTail } from '@/lib/copilot/tools/server/docs/search-docs'

describe('docsScopeTail', () => {
  it('returns undefined for an unscoped search', () => {
    expect(docsScopeTail(undefined)).toBeUndefined()
    expect(docsScopeTail('')).toBeUndefined()
    expect(docsScopeTail('  ')).toBeUndefined()
  })

  it('treats the bare docs/documentation prefix as unscoped', () => {
    expect(docsScopeTail('docs/documentation')).toBeUndefined()
    expect(docsScopeTail('docs/documentation/')).toBeUndefined()
    expect(docsScopeTail('/docs/documentation/')).toBeUndefined()
  })

  it('maps directory scopes to their source_document tail', () => {
    expect(docsScopeTail('docs/documentation/workflows')).toBe('workflows')
    expect(docsScopeTail('/docs/documentation/workflows/')).toBe('workflows')
    expect(docsScopeTail('docs/documentation/integrations/gmail')).toBe('integrations/gmail')
  })

  it('maps file scopes by stripping the mdx extension', () => {
    expect(docsScopeTail('docs/documentation/agents/choosing.mdx')).toBe('agents/choosing')
    expect(docsScopeTail('docs/documentation/workflows/index.mdx')).toBe('workflows')
  })

  it('rejects paths outside docs/documentation/', () => {
    expect(() => docsScopeTail('docs/academy/agents')).toThrow(/must start with/)
    expect(() => docsScopeTail('docs/api-reference/workflows.json')).toThrow(/must start with/)
    expect(() => docsScopeTail('workflows')).toThrow(/must start with/)
    expect(() => docsScopeTail('docs/documentation-extra/foo')).toThrow(/must start with/)
  })
})
