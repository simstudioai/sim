import fs from 'fs/promises'
import path from 'path'
import matter from 'gray-matter'
import { compileMDX } from 'next-mdx-remote/rsc'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypeSlug from 'rehype-slug'
import remarkGfm from 'remark-gfm'
import { mdxComponents } from './mdx'
import type { BlogMeta, BlogPost, TagWithCount } from './schema'
import { AuthorSchema, BlogFrontmatterSchema } from './schema'
import { AUTHORS_DIR, BLOG_DIR, byDateDesc, ensureContentDirs, toIsoDate } from './utils'

let cachedMeta: BlogMeta[] | null = null
let cachedAuthors: Record<string, any> | null = null

async function loadAuthors(): Promise<Record<string, any>> {
  if (cachedAuthors) return cachedAuthors
  await ensureContentDirs()
  const files = await fs.readdir(AUTHORS_DIR).catch(() => [])
  const authors: Record<string, any> = {}
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const raw = await fs.readFile(path.join(AUTHORS_DIR, file), 'utf-8')
    const json = JSON.parse(raw)
    const author = AuthorSchema.parse(json)
    authors[author.id] = author
  }
  cachedAuthors = authors
  return authors
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
}

async function scanFrontmatters(): Promise<BlogMeta[]> {
  if (cachedMeta) return cachedMeta
  await ensureContentDirs()
  const entries = await fs.readdir(BLOG_DIR).catch(() => [])
  const authorsMap = await loadAuthors()
  const results: BlogMeta[] = []
  for (const slug of entries) {
    const postDir = path.join(BLOG_DIR, slug)
    const stat = await fs.stat(postDir).catch(() => null)
    if (!stat || !stat.isDirectory()) continue
    const mdxPath = path.join(postDir, 'index.mdx')
    const hasMdx = await fs
      .stat(mdxPath)
      .then((s) => s.isFile())
      .catch(() => false)
    if (!hasMdx) continue
    const raw = await fs.readFile(mdxPath, 'utf-8')
    const { data } = matter(raw)
    const fm = BlogFrontmatterSchema.parse(data)
    const authors = fm.authors.map((id) => authorsMap[id]).filter(Boolean)
    if (authors.length === 0) throw new Error(`Authors not found for "${slug}"`)
    results.push({
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
      canonical: fm.canonical,
      ogAlt: fm.ogAlt,
      about: fm.about,
      timeRequired: fm.timeRequired,
      faq: fm.faq,
      draft: fm.draft,
      featured: fm.featured ?? false,
    })
  }
  cachedMeta = results.sort(byDateDesc)
  return cachedMeta
}

export async function getAllPostMeta(): Promise<BlogMeta[]> {
  return (await scanFrontmatters()).filter((p) => !p.draft)
}

export async function getAllTags(): Promise<TagWithCount[]> {
  const posts = await getAllPostMeta()
  const counts: Record<string, number> = {}
  for (const p of posts) {
    for (const t of p.tags) counts[t] = (counts[t] || 0) + 1
  }
  return Object.entries(counts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

export async function getPostBySlug(slug: string): Promise<BlogPost> {
  const meta = await scanFrontmatters()
  const found = meta.find((m) => m.slug === slug)
  if (!found) throw new Error(`Post not found: ${slug}`)
  const mdxPath = path.join(BLOG_DIR, slug, 'index.mdx')
  const raw = await fs.readFile(mdxPath, 'utf-8')
  const { content, data } = matter(raw)
  const fm = BlogFrontmatterSchema.parse(data)
  const compiled = await compileMDX({
    source: content,
    components: mdxComponents as any,
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
      headings.push({ text, id: slugify(text) })
    }
  }
  return {
    ...found,
    Content: () => (compiled as any).content,
    updated: fm.updated ? toIsoDate(fm.updated) : found.updated,
    headings,
  }
}

export function invalidateBlogCaches() {
  cachedMeta = null
  cachedAuthors = null
}

export async function getRelatedPosts(slug: string, limit = 3): Promise<BlogMeta[]> {
  const posts = await getAllPostMeta()
  const current = posts.find((p) => p.slug === slug)
  if (!current) return []
  const scored = posts
    .filter((p) => p.slug !== slug)
    .map((p) => ({
      post: p,
      score: p.tags.filter((t) => current.tags.includes(t)).length,
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || byDateDesc(a.post, b.post))
    .slice(0, limit)
    .map((x) => x.post)
  return scored
}
