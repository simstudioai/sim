import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export default {
  plugins: {
    '@tailwindcss/postcss': {},
    [require.resolve('@sim/emcn-platform/styles/system-appearance.cjs')]: {},
  },
}
