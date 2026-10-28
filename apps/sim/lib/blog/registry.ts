import path from 'path'
import { BLOG_SECTION } from '@/lib/blog/seo'
import { createContentRegistry } from '@/lib/content/registry-factory'

const BLOG_DIR = path.join(process.cwd(), 'content', 'blog')
const AUTHORS_DIR = path.join(process.cwd(), 'content', 'authors')

/** Posts that ship custom MDX component overrides alongside their content. */
const BLOG_COMPONENT_LOADERS = {
  enterprise: () => import('@/content/blog/enterprise/components'),
  'v0-5': () => import('@/content/blog/v0-5/components'),
  'agent-as-yjs-peer': () => import('@/content/blog/agent-as-yjs-peer/components'),
}

const blogRegistry = createContentRegistry({
  contentDir: BLOG_DIR,
  authorsDir: AUTHORS_DIR,
  basePath: BLOG_SECTION.basePath,
  componentLoaders: BLOG_COMPONENT_LOADERS,
})

export const getAllPostMeta = blogRegistry.getAllPostMeta
export const getPostBySlug = blogRegistry.getPostBySlug
export const getAllTags = blogRegistry.getAllTags
export const getRelatedPosts = blogRegistry.getRelatedPosts
