import { fileURLToPath } from 'node:url'

/**
 * Plugins resolve to absolute paths from this file's own URL. Turbopack loads the
 * PostCSS config in a worker and resolves plugin ids from a generated chunk
 * directory, so a project-relative specifier is not found there.
 */
const hairlineBorderWidth = fileURLToPath(
  new URL('./lib/postcss/hairline-border-width.cjs', import.meta.url)
)
const systemAppearance = fileURLToPath(
  new URL('./lib/postcss/system-appearance.cjs', import.meta.url)
)

/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
    // Must run after Tailwind: it rewrites Tailwind's own border-width output, outside the product.
    [hairlineBorderWidth]: {},
    // The product's system appearance before React hydrates; touches only its theme rules.
    [systemAppearance]: {},
  },
}

export default config
