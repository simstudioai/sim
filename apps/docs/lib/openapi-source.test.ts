import { readFileSync } from 'node:fs'
import path from 'node:path'
import { loader, multiple } from 'fumadocs-core/source'
import { describe, expect, it } from 'vitest'
import { i18n } from '@/lib/i18n'
import { createApiReferenceSource } from '@/lib/openapi-source'

interface ApiReferenceMeta {
  pages: string[]
}

describe('OpenAPI source', () => {
  it('resolves every generated navigation group for every locale', async () => {
    const source = loader(multiple({ openapi: await createApiReferenceSource() }), {
      baseUrl: '/',
      i18n,
    })

    for (const locale of i18n.languages) {
      const metaPath = path.resolve(
        import.meta.dirname,
        `../content/docs/${locale}/api-reference/meta.json`
      )
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as ApiReferenceMeta
      const generatedGroups = meta.pages.filter((page) => page.startsWith('(generated)/'))

      expect(generatedGroups).toContain('(generated)/catalog')
      expect(generatedGroups).toContain('(generated)/meta')

      const pages = source.getPages(locale)
      for (const group of generatedGroups) {
        const groupSlug = group.replace('(generated)/', '')
        const localePrefix = locale === i18n.defaultLanguage ? '' : `/${locale}`
        const groupUrlPrefix = `${localePrefix}/api-reference/${groupSlug}/`
        expect(pages.some((page) => page.url.startsWith(groupUrlPrefix))).toBe(true)
      }
    }
  })
})
