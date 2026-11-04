import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export default {
  plugins: {
    '@tailwindcss/postcss': {},
    [require.resolve('./design-system/styles/system-appearance.cjs')]: {},
  },
}
