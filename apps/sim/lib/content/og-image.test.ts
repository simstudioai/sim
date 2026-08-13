/**
 * @vitest-environment node
 */
import fs from 'fs'
import path from 'path'
import matter from 'gray-matter'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

/**
 * Guards the content invariant behind `ogImageWidth`/`ogImageHeight` in
 * `registry-factory`: every local `ogImage` must exist and expose intrinsic
 * dimensions, or the SEO builders silently fall back to a 1200x630 default that
 * misdescribes the real asset.
 *
 * It also pins the format to one the social crawlers actually accept. SVG is the
 * trap worth naming: it renders fine in the browser and `sharp` reports
 * dimensions for it, so a dimension check alone would pass while Open Graph
 * previews silently break.
 */
const CRAWLER_SAFE_FORMATS = ['jpeg', 'png', 'webp', 'gif']

function collectOgImages(): { slug: string; ogImage: string }[] {
  const entries: { slug: string; ogImage: string }[] = []
  for (const dir of ['content/blog', 'content/library']) {
    if (!fs.existsSync(dir)) continue
    for (const slug of fs.readdirSync(dir)) {
      const mdxPath = path.join(dir, slug, 'index.mdx')
      if (!fs.existsSync(mdxPath)) continue
      const { data } = matter(fs.readFileSync(mdxPath, 'utf-8'))
      if (typeof data.ogImage === 'string' && !data.ogImage.startsWith('http')) {
        entries.push({ slug, ogImage: data.ogImage })
      }
    }
  }
  return entries
}

describe('content OG images', () => {
  const entries = collectOgImages()

  it('finds local OG images to check', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  it.each(entries)('$slug resolves readable dimensions for $ogImage', async ({ ogImage }) => {
    const file = path.join('public', ogImage)
    expect(fs.existsSync(file), `${file} does not exist`).toBe(true)

    const { width, height, format } = await sharp(fs.readFileSync(file)).metadata()
    expect(width, `${file} has no readable width`).toBeGreaterThan(0)
    expect(height, `${file} has no readable height`).toBeGreaterThan(0)
    expect(CRAWLER_SAFE_FORMATS, `${file} is a ${format}, which crawlers reject`).toContain(format)
  })
})
