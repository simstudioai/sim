import type messages from '@/translations/en.json'
import type { locales } from './request'

declare module 'next-intl' {
  interface AppConfig {
    Locale: (typeof locales)[number]
    Messages: typeof messages
  }
}
