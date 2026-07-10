import path from 'path'
import { createContentRegistry } from '@/lib/content/registry-factory'

const BLOG_DIR = path.join(process.cwd(), 'content', 'blog')
const AUTHORS_DIR = path.join(process.cwd(), 'content', 'authors')

/** Posts that ship custom MDX component overrides alongside their content. */
const BLOG_COMPONENT_LOADERS = {
  enterprise: () => import('@/content/blog/enterprise/components'),
  'v0-5': () => import('@/content/blog/v0-5/components'),
}

const blogRegistry = createContentRegistry({
  contentDir: BLOG_DIR,
  authorsDir: AUTHORS_DIR,
  componentLoaders: BLOG_COMPONENT_LOADERS,
})

export const getAllPostMeta = blogRegistry.getAllPostMeta
export const getPostBySlug = blogRegistry.getPostBySlug
export const getAllTags = blogRegistry.getAllTags
export const getRelatedPosts = blogRegistry.getRelatedPosts
export const getNavBlogPosts = blogRegistry.getNavPosts
export const invalidateBlogCaches = blogRegistry.invalidateCaches
