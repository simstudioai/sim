import fs from 'fs/promises'
import path from 'path'
import { cache } from 'react'
import matter from 'gray-matter'
import { imageSize } from 'image-size'
import { compileMDX } from 'next-mdx-remote/rsc'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypeSlug from 'rehype-slug'
import remarkGfm from 'remark-gfm'
import { mdxComponents } from '@/lib/content/mdx'
import type { Author, ContentMeta, ContentPost, TagWithCount } from '@/lib/content/schema'
import { AuthorSchema, ContentFrontmatterSchema } from '@/lib/content/schema'
import { byDateDesc, ensureContentDirs, toIsoDate } from '@/lib/content/utils'

/** Loads a post's custom MDX component overrides, keyed by slug. */
export type ContentComponentLoaders = Record<
  string,
  () => Promise<Record<string, React.ComponentType<any>>>
>

export interface ContentRegistryConfig {
  /** Directory holding one folder per post (`<contentDir>/<slug>/index.mdx`). */
  contentDir: string
  /** Directory holding one JSON file per author, shared across sections. */
  authorsDir: string
  /** Per-slug custom MDX component overrides, merged over the base `mdxComponents` map. */
  componentLoaders?: ContentComponentLoaders
}

export interface ContentRegistry {
  getAllPostMeta: () => Promise<ContentMeta[]>
  getPostBySlug: (slug: string) => Promise<ContentPost>
  getAllTags: () => Promise<TagWithCount[]>
  getRelatedPosts: (slug: string, limit?: number) => Promise<ContentMeta[]>
  getNavPosts: () => Promise<Pick<ContentMeta, 'slug' | 'title' | 'ogImage'>[]>
  invalidateCaches: () => void
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
}

/**
 * Author JSON is shared across every section (blog, library, ...) that
 * points at the same `authorsDir`. Cache the parsed result per directory at
 * module scope so multiple registry instantiations never re-read/re-parse
 * the same author files.
 */
const authorsCacheByDir = new Map<string, Promise<Record<string, Author>>>()

async function loadAuthorsForDir(authorsDir: string): Promise<Record<string, Author>> {
  const cached = authorsCacheByDir.get(authorsDir)
  if (cached) return cached
  const promise = (async () => {
    await fs.mkdir(authorsDir, { recursive: true })
    const files = await fs.readdir(authorsDir).catch(() => [])
    const authors: Record<string, Author> = {}
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const raw = await fs.readFile(path.join(authorsDir, file), 'utf-8')
      const json = JSON.parse(raw)
      const author = AuthorSchema.parse(json)
      authors[author.id] = author
    }
    return authors
  })()
  authorsCacheByDir.set(authorsDir, promise)
  return promise
}

/**
 * Builds an independent content registry (frontmatter scanning, MDX
 * compilation, tag/related-post derivation, in-memory caching) over a single
 * content directory. Each call owns its own post-level cache state via
 * closures, so separate instantiations (e.g. blog vs. library) never
 * collide, while the shared author pool is cached once per `authorsDir`
 * (see `loadAuthorsForDir`).
 */
export function createContentRegistry(config: ContentRegistryConfig): ContentRegistry {
  const { contentDir, authorsDir, componentLoaders = {} } = config

  const postComponentsRegistry: Record<string, Record<string, React.ComponentType>> = {}
  let cachedMeta: ContentMeta[] | null = null

  async function loadAuthors(): Promise<Record<string, Author>> {
    return loadAuthorsForDir(authorsDir)
  }

  /**
   * Reads the intrinsic pixel dimensions of a local `public/` OG image so the
   * SEO builders can declare accurate `og:image` and JSON-LD sizes. Returns
   * null for remote URLs or unreadable files, in which case the builders fall
   * back to the 1200x630 OG default.
   */
  async function readOgImageDimensions(
    ogImage: string
  ): Promise<{ width: number; height: number } | null> {
    if (ogImage.startsWith('http')) return null
    try {
      const buffer = await fs.readFile(path.join(process.cwd(), 'public', ogImage))
      const { width, height } = imageSize(buffer)
      return width && height ? { width, height } : null
    } catch {
      return null
    }
  }

  async function scanFrontmatters(): Promise<ContentMeta[]> {
    if (cachedMeta) {
      return cachedMeta
    }
    await ensureContentDirs(contentDir, authorsDir)
    const entries = await fs.readdir(contentDir).catch(() => [])
    const authorsMap = await loadAuthors()
    const results = await Promise.all(
      entries.map(async (slug): Promise<ContentMeta | null> => {
        const postDir = path.join(contentDir, slug)
        const stat = await fs.stat(postDir).catch(() => null)
        if (!stat || !stat.isDirectory()) return null
        const mdxPath = path.join(postDir, 'index.mdx')
        const hasMdx = await fs
          .stat(mdxPath)
          .then((s) => s.isFile())
          .catch(() => false)
        if (!hasMdx) return null
        const raw = await fs.readFile(mdxPath, 'utf-8')
        const { data, content: mdxContent } = matter(raw)
        const fm = ContentFrontmatterSchema.parse(data)
        const wordCount = mdxContent
          .replace(/```[\s\S]*?```/g, '')
          .replace(/import\s+.*?from\s+['"].*?['"]/g, '')
          .replace(/<[^>]+>/g, '')
          .replace(/[#*_~`[\]()!|>-]/g, '')
          .split(/\s+/)
          .filter((w) => w.length > 0).length
        const authors = fm.authors.map((id) => authorsMap[id]).filter(Boolean)
        if (authors.length === 0) throw new Error(`Authors not found for "${slug}"`)
        const ogImageDimensions = await readOgImageDimensions(fm.ogImage)
        return {
          slug: fm.slug,
          title: fm.title,
          description: fm.description,
          date: toIsoDate(fm.date),
          updated: fm.updated ? toIsoDate(fm.updated) : undefined,
          author: authors[0],
          authors,
          readingTime: fm.readingTime,
          tags: fm.tags,
          ogImage: fm.ogImage,
          ogImageWidth: ogImageDimensions?.width,
          ogImageHeight: ogImageDimensions?.height,
          canonical: fm.canonical,
          ogAlt: fm.ogAlt,
          about: fm.about,
          timeRequired: fm.timeRequired,
          faq: fm.faq,
          wordCount,
          draft: fm.draft,
          featured: fm.featured ?? false,
          technical: fm.technical,
        }
      })
    )
    cachedMeta = results.filter((result): result is ContentMeta => result !== null).sort(byDateDesc)
    return cachedMeta
  }

  async function getAllPostMeta(): Promise<ContentMeta[]> {
    return (await scanFrontmatters()).filter((p) => !p.draft)
  }

  /**
   * Featured + 5 most recent posts for a navbar dropdown preview. Reserved
   * for a future Blog/Library nav dropdown (same "defined but not yet wired
   * up" pattern as `PLATFORM_MENU`/`SOLUTIONS_MENU` in
   * `navbar/components/nav-menu-chip/constants.ts`); currently unconsumed.
   */
  const getNavPosts = cache(
    async (): Promise<Pick<ContentMeta, 'slug' | 'title' | 'ogImage'>[]> => {
      const allPosts = await getAllPostMeta()
      const featuredPost = allPosts.find((p) => p.featured) ?? allPosts[0]
      if (!featuredPost) return []
      const recentPosts = allPosts.filter((p) => p.slug !== featuredPost.slug).slice(0, 5)
      return [featuredPost, ...recentPosts].map((p) => ({
        slug: p.slug,
        title: p.title,
        ogImage: p.ogImage,
      }))
    }
  )

  async function getAllTags(): Promise<TagWithCount[]> {
    const posts = await getAllPostMeta()
    const counts: Record<string, number> = {}
    for (const p of posts) {
      for (const t of p.tags) counts[t] = (counts[t] || 0) + 1
    }
    return Object.entries(counts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  }

  async function loadPostComponents(slug: string): Promise<Record<string, React.ComponentType>> {
    if (postComponentsRegistry[slug]) {
      return postComponentsRegistry[slug]
    }

    const loader = componentLoaders[slug]
    if (!loader) {
      postComponentsRegistry[slug] = {}
      return {}
    }

    try {
      const postComponents = await loader()
      postComponentsRegistry[slug] = postComponents
      return postComponents
    } catch {
      postComponentsRegistry[slug] = {}
      return {}
    }
  }

  async function getPostBySlug(slug: string): Promise<ContentPost> {
    const meta = await scanFrontmatters()
    const found = meta.find((m) => m.slug === slug)
    if (!found) throw new Error(`Post not found: ${slug}`)
    const mdxPath = path.join(contentDir, slug, 'index.mdx')
    const raw = await fs.readFile(mdxPath, 'utf-8')
    const { content, data } = matter(raw)
    const fm = ContentFrontmatterSchema.parse(data)

    const postComponents = await loadPostComponents(slug)
    const mergedComponents = { ...mdxComponents, ...postComponents }

    const compiled = await compileMDX({
      source: content,
      components: mergedComponents as any,
      options: {
        parseFrontmatter: false,
        mdxOptions: {
          remarkPlugins: [remarkGfm],
          rehypePlugins: [
            rehypeSlug,
            [rehypeAutolinkHeadings, { behavior: 'wrap', properties: { className: 'anchor' } }],
          ],
        },
      },
    })
    const headings: { text: string; id: string }[] = []
    const lines = content.split('\n')
    for (const line of lines) {
      const match = /^##\s+(.+)$/.exec(line.trim())
      if (match) {
        const text = match[1].trim()
        headings.push({ text, id: slugifyHeading(text) })
      }
    }
    return {
      ...found,
      Content: () => (compiled as any).content,
      updated: fm.updated ? toIsoDate(fm.updated) : found.updated,
      headings,
    }
  }

  async function getRelatedPosts(slug: string, limit = 3): Promise<ContentMeta[]> {
    const posts = await getAllPostMeta()
    const current = posts.find((p) => p.slug === slug)
    if (!current) return []
    const others = posts.filter((p) => p.slug !== slug)
    return others
      .map((p) => ({
        post: p,
        score: p.tags.filter((t) => current.tags.includes(t)).length,
      }))
      .sort((a, b) => b.score - a.score || byDateDesc(a.post, b.post))
      .slice(0, limit)
      .map((x) => x.post)
  }

  function invalidateCaches() {
    cachedMeta = null
    authorsCacheByDir.delete(authorsDir)
    Object.keys(postComponentsRegistry).forEach((key) => delete postComponentsRegistry[key])
  }

  return {
    getAllPostMeta,
    getPostBySlug,
    getAllTags,
    getRelatedPosts,
    getNavPosts,
    invalidateCaches,
  }
}
