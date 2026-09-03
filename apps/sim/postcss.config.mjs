import { fileURLToPath } from 'node:url'

/**
 * Resolved to an absolute path from this file's own URL. Turbopack loads the
 * PostCSS config in a worker and resolves plugin ids from a generated chunk
 * directory, so a project-relative specifier is not found there.
 */
const hairlineBorderWidth = fileURLToPath(
  new URL('./lib/postcss/hairline-border-width.mjs', import.meta.url)
)

/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
    // Must run after Tailwind: it rewrites Tailwind's own border-width output.
    [hairlineBorderWidth]: {},
  },
}

export default config
