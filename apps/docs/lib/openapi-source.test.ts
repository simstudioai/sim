import { readFileSync } from 'node:fs'
import path from 'node:path'
import { loader, multiple } from 'fumadocs-core/source'
import { describe, expect, it } from 'vitest'
import { createApiReferenceSource } from '@/lib/openapi-source'

interface ApiReferenceMeta {
  pages: string[]
}

describe('OpenAPI source', () => {
  it('resolves every generated navigation group', async () => {
    const source = loader(multiple({ openapi: await createApiReferenceSource() }), {
      baseUrl: '/',
    })

    const metaPath = path.resolve(import.meta.dirname, '../content/docs/api-reference/meta.json')
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as ApiReferenceMeta
    const generatedGroups = meta.pages.filter((page) => page.startsWith('(generated)/'))

    expect(generatedGroups).toContain('(generated)/catalog')
    expect(generatedGroups).toContain('(generated)/meta')

    const pages = source.getPages()
    for (const group of generatedGroups) {
      const groupSlug = group.replace('(generated)/', '')
      expect(pages.some((page) => page.url.startsWith(`/api-reference/${groupSlug}/`))).toBe(true)
    }
  })
})
