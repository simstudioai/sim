import { defineI18n } from 'fumadocs-core/i18n'

export const i18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en', 'es', 'fr', 'de', 'ja', 'zh'],
  hideLocale: 'default-locale',
  parser: 'dir',
})
