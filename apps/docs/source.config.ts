import { defineConfig, defineDocs, frontmatterSchema } from 'fumadocs-mdx/config'
import { z } from 'zod'

/**
 * Diátaxis page type — an internal authoring taxonomy surfaced to readers as a
 * small badge near the page title. Optional so existing pages render unchanged
 * until backfilled. Only collections may be exported from this file, so the
 * shared type lives in `@/lib/source` (`DocsPageType`).
 */
export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    schema: frontmatterSchema.extend({
      pageType: z.enum(['tutorial', 'guide', 'reference', 'concept']).optional(),
    }),
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
})

export default defineConfig()
