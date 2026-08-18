import { defineConfig, defineDocs, frontmatterSchema } from 'fumadocs-mdx/config'
import { curlJsonBodyGrammar } from './lib/shiki-curl-json'
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
    rehypeCodeOptions: {
      ...simShikiOptions,
      /** Preloads the injection that colors a `curl -d '{…}'` body — see lib/shiki-curl-json.ts. */
      langs: [curlJsonBodyGrammar],
    },
  },
})
