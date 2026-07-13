import { z } from 'zod'

export const AuthorSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    url: z.string().url().optional(),
    xHandle: z.string().optional(),
    avatarUrl: z.string().optional(), // allow relative or absolute
  })
  .strict()

export type Author = z.infer<typeof AuthorSchema>

/**
 * Frontmatter schema shared by every content section (blog, library, and any
 * future section). Section-specific behavior lives in the section's registry
 * instantiation, not in this schema.
 */
export const ContentFrontmatterSchema = z
  .object({
    slug: z.string().min(1),
    title: z.string().min(5),
    description: z.string().min(20),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    authors: z.array(z.string()).min(1),
    readingTime: z.number().int().positive().optional(),
    tags: z.array(z.string()).default([]),
    ogImage: z.string().min(1), // local path (e.g. /blog/<slug>/cover.jpg) - rendered via next/image without `unoptimized`
    ogAlt: z.string().optional(),
    about: z.array(z.string()).optional(),
    timeRequired: z.string().optional(),
    faq: z
      .array(
        z.object({
          q: z.string().min(1),
          a: z.string().min(1),
        })
      )
      .optional(),
    canonical: z.string().url(),
    draft: z.boolean().default(false),
    featured: z.boolean().default(false),
    /**
     * Whether this post covers technical/developer content (architecture,
     * implementation, how-tos). Drives whether `TechArticle` is included
     * alongside `BlogPosting` in the post's JSON-LD `@type` — general
     * announcements (funding, company news) should set this to `false`.
     */
    technical: z.boolean().default(true),
  })
  .strict()

export type ContentFrontmatter = z.infer<typeof ContentFrontmatterSchema>

export interface ContentMeta {
  slug: string
  title: string
  description: string
  date: string // ISO
  updated?: string // ISO
  author: Author
  authors: Author[]
  readingTime?: number
  tags: string[]
  ogImage: string
  /** Intrinsic pixel width of a local `ogImage`, probed at scan time; absent for remote or unreadable images. */
  ogImageWidth?: number
  /** Intrinsic pixel height of a local `ogImage`, probed at scan time; absent for remote or unreadable images. */
  ogImageHeight?: number
  ogAlt?: string
  about?: string[]
  timeRequired?: string
  faq?: { q: string; a: string }[]
  wordCount?: number
  canonical: string
  draft: boolean
  featured: boolean
  technical: boolean
}

export interface ContentPost extends ContentMeta {
  Content: React.ComponentType
  headings?: { text: string; id: string }[]
}

export interface TagWithCount {
  tag: string
  count: number
}
