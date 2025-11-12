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

export const BlogFrontmatterSchema = z
  .object({
    slug: z.string().min(1),
    title: z.string().min(5),
    description: z.string().min(20),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    authors: z.array(z.string()).min(1),
    readingTime: z.number().int().positive().optional(),
    tags: z.array(z.string()).default([]),
    ogImage: z.string().min(1),
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
  })
  .strict()

export type BlogFrontmatter = z.infer<typeof BlogFrontmatterSchema>

export interface BlogMeta {
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
  ogAlt?: string
  about?: string[]
  timeRequired?: string
  faq?: { q: string; a: string }[]
  canonical: string
  draft: boolean
  featured: boolean
  sourcePath?: string
}

export interface BlogPost extends BlogMeta {
  Content: React.ComponentType
  headings?: { text: string; id: string }[]
}

export interface TagWithCount {
  tag: string
  count: number
}
