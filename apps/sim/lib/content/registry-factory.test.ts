/**
 * @vitest-environment node
 */
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/** Fails `import('sharp')` the way an unloadable native binary does. */
vi.mock('sharp', () => {
  throw new Error('Could not load the sharp module using the linux-x64 runtime')
})

vi.mock('next-mdx-remote/rsc', () => ({
  compileMDX: vi.fn(async () => ({ content: null })),
}))

vi.mock('@/lib/content/mdx', () => ({ mdxComponents: {} }))

import { createContentRegistry } from '@/lib/content/registry-factory'

let root: string
let contentDir: string
let authorsDir: string

const POST = `---
slug: sharp-is-unavailable
title: Sharp Is Unavailable
description: The registry still serves posts when the native binary is missing.
date: 2026-08-10
authors: [waleed]
ogImage: /blog/missing-og.png
canonical: https://sim.ai/blog/sharp-is-unavailable
---

Body copy.
`

const AUTHOR = JSON.stringify({ id: 'waleed', name: 'Waleed Latif' })

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'content-registry-'))
  contentDir = path.join(root, 'content', 'blog')
  authorsDir = path.join(root, 'content', 'authors')
  await fs.mkdir(path.join(contentDir, 'sharp-is-unavailable'), { recursive: true })
  await fs.mkdir(authorsDir, { recursive: true })
  await fs.writeFile(path.join(contentDir, 'sharp-is-unavailable', 'index.mdx'), POST)
  await fs.writeFile(path.join(authorsDir, 'waleed.json'), AUTHOR)
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('createContentRegistry without a loadable sharp', () => {
  it('still lists posts, omitting only the OG dimensions', async () => {
    const registry = createContentRegistry({ contentDir, authorsDir })

    const posts = await registry.getAllPostMeta()

    expect(posts).toHaveLength(1)
    expect(posts[0].slug).toBe('sharp-is-unavailable')
    expect(posts[0].ogImage).toBe('/blog/missing-og.png')
    expect(posts[0].ogImageWidth).toBeUndefined()
    expect(posts[0].ogImageHeight).toBeUndefined()
  })

  it('still resolves a single post by slug', async () => {
    const registry = createContentRegistry({ contentDir, authorsDir })

    const post = await registry.getPostBySlug('sharp-is-unavailable')

    expect(post?.title).toBe('Sharp Is Unavailable')
  })
})
