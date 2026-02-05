import type { BrandConfig } from './types'

/**
 * Default brand configuration values
 */
export const defaultBrandConfig: BrandConfig = {
  name: 'Sim',
  logoUrl: undefined,
  faviconUrl: '/favicon/favicon.ico',
  customCssUrl: undefined,
  supportEmail: 'help@sim.ai',
  documentationUrl: undefined,
  termsUrl: undefined,
  privacyUrl: undefined,
  theme: {
    primaryColor: '#701ffc',
    primaryHoverColor: '#802fff',
    accentColor: '#9d54ff',
    accentHoverColor: '#a66fff',
    backgroundColor: '#0c0c0c',
  },
}
