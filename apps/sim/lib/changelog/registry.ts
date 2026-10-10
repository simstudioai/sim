import path from 'node:path'
import { CHANGELOG_SECTION } from '@/lib/changelog/constants'
import { changelogComponents } from '@/lib/changelog/mdx'
import { createContentRegistry } from '@/lib/content/registry-factory'

const registry = createContentRegistry({
  contentDir: path.join(process.cwd(), 'content', 'changelog'),
  authorsDir: path.join(process.cwd(), 'content', 'authors'),
  basePath: CHANGELOG_SECTION.basePath,
  components: changelogComponents,
  scopeHeadingIds: true,
})

/** Public consumers always receive published entries. */
export async function getAllEntryMeta() {
  return registry.getAllPostMeta()
}

/** Returns only published updates, including for direct links. */
export async function getEntryBySlug(slug: string) {
  const entries = await getAllEntryMeta()
  if (!entries.some((entry) => entry.slug === slug)) return null
  return registry.getPostBySlug(slug)
}

/** Draft previews are local-only and reread metadata after editorial changes. */
export async function getAllEntryPreviews() {
  if (process.env.NODE_ENV !== 'development') return []
  registry.invalidateCaches()
  return registry.getAllPostMeta({ includeDrafts: true })
}

/** Never expose an unpublished body outside the development preview. */
export async function getEntryPreview(slug: string) {
  if (process.env.NODE_ENV !== 'development') return null
  registry.invalidateCaches()
  return registry.getPostBySlug(slug)
}
