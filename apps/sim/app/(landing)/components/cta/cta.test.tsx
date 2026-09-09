/** @vitest-environment jsdom */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { Cta } from '@/app/(landing)/components/cta/cta'
import { FOOTER_ARTWORK } from '@/app/(landing)/components/cta/footer-artwork.generated'

vi.mock('@/app/(landing)/components/hero-cta', () => ({ HeroCta: () => null }))

describe('Footer artwork delivery', () => {
  it('renders responsive static sources with lazy, decorative fallbacks and no optimizer requests', () => {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(<Cta />)
    expect(host.innerHTML).not.toContain('/_next/image')
    expect(host.querySelectorAll('picture')).toHaveLength(2)
    expect(host.querySelector('picture')?.className).toContain('dark:hidden')
    expect(host.querySelectorAll('picture')[1].className).toContain('dark:block')
    for (const picture of host.querySelectorAll('picture')) {
      expect(picture.closest('[aria-hidden="true"]')).not.toBeNull()
      expect([...picture.querySelectorAll('source')].map((source) => source.type)).toEqual([
        'image/avif',
        'image/webp',
      ])
      const image = picture.querySelector('img')!
      expect(image.getAttribute('loading')).toBe('lazy')
      expect(image.alt).toBe('')
      expect(image.src).toContain('/landing/footer-artwork/')
      expect(image.getAttribute('style')).toContain('data:image/svg+xml')
    }
  })

  it('ships every advertised size with the matching dimensions and immutable content hash', async () => {
    for (const artwork of Object.values(FOOTER_ARTWORK)) {
      for (const srcSet of [artwork.avifSrcSet, artwork.webpSrcSet]) {
        for (const entry of srcSet.split(', ')) {
          const [src, descriptor] = entry.split(' ')
          const width = Number.parseInt(descriptor, 10)
          const buffer = await readFile(path.join(process.cwd(), 'public', src))
          const metadata = await sharp(buffer).metadata()
          expect(metadata.width).toBe(width)
          expect(metadata.height).toBe((width * 9) / 16)
          expect(src).toContain(createHash('sha256').update(buffer).digest('hex').slice(0, 12))
        }
      }
    }
  })
})
