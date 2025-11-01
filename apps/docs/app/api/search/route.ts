import { createFromSource } from 'fumadocs-core/search/server'
import { source } from '@/lib/source'

export const revalidate = false

export const { staticGET: GET } = createFromSource(source, {
  localeMap: {
    en: { language: 'english' },
    es: { language: 'spanish' },
    fr: { language: 'french' },
    de: { language: 'german' },
    // ja and zh are not supported by the stemmer library, so we'll skip language config for them
    ja: {},
    zh: {},
  },
})
