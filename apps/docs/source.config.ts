import { defineConfig, defineDocs, frontmatterSchema } from 'fumadocs-mdx/config'

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: frontmatterSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
})

export default defineConfig()
