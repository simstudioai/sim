import path from 'path'
import { createContentRegistry } from '@/lib/content/registry-factory'
import { LIBRARY_SECTION } from '@/lib/library/seo'

const LIBRARY_DIR = path.join(process.cwd(), 'content', 'library')
const AUTHORS_DIR = path.join(process.cwd(), 'content', 'authors')

const libraryRegistry = createContentRegistry({
  contentDir: LIBRARY_DIR,
  authorsDir: AUTHORS_DIR,
  basePath: LIBRARY_SECTION.basePath,
})

export const getAllPostMeta = libraryRegistry.getAllPostMeta
export const getPostBySlug = libraryRegistry.getPostBySlug
export const getPostSource = libraryRegistry.getPostSource
export const getAllTags = libraryRegistry.getAllTags
export const getRelatedPosts = libraryRegistry.getRelatedPosts
