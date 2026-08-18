import { defineConfig, defineDocs, frontmatterSchema } from 'fumadocs-mdx/config'
import { simShikiOptions } from './lib/shiki-theme'

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: frontmatterSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
})

export default defineConfig({
  mdxOptions: {
    /**
     * Shiki defaults to `github-light` / `github-dark`, whose blues and purples appear nowhere
     * in the product. These themes carry the platform's own token colors instead — see
     * `lib/shiki-theme.ts`.
     */
    rehypeCodeOptions: simShikiOptions,
  },
})
