import type { MetadataRoute } from 'next'
import { i18n } from '@/lib/i18n'
import { source } from '@/lib/source'
import { DOCS_BASE_URL } from '@/lib/urls'

export const revalidate = 3600

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = DOCS_BASE_URL
  const languages = source.getLanguages()

  const pagesBySlug = new Map<string, Map<string, string>>()
  for (const { language, pages } of languages) {
    for (const page of pages) {
      const key = page.slugs.join('/')
      if (!pagesBySlug.has(key)) {
        pagesBySlug.set(key, new Map())
      }
      pagesBySlug.get(key)!.set(language, `${baseUrl}${page.url}`)
    }
  }

  const entries: MetadataRoute.Sitemap = []
  for (const [, localeMap] of pagesBySlug) {
    const defaultUrl = localeMap.get(i18n.defaultLanguage)
    if (!defaultUrl) continue

    const langAlternates: Record<string, string> = {}
    for (const [lang, url] of localeMap) {
      langAlternates[lang] = url
    }

    langAlternates['x-default'] = defaultUrl

    entries.push({
      url: defaultUrl,
      alternates: { languages: langAlternates },
    })
  }

  return entries
}
