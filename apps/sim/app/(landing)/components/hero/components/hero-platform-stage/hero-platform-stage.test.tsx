/** @vitest-environment node */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { HERO_ARTWORK } from '@/app/(landing)/components/hero/components/hero-platform-stage/hero-artwork.generated'
import { HeroPlatformStage } from '@/app/(landing)/components/hero/components/hero-platform-stage/hero-platform-stage'

vi.mock('@sim/emcn', () => ({ cn: (...values: string[]) => values.join(' ') }))
vi.mock('@/app/(landing)/components/hero/components/hero-platform-loop', () => ({
  HeroPlatformLoopMount: () => null,
}))
vi.mock(
  '@/app/(landing)/components/hero/components/hero-platform-stage/mobile-hero-workflow',
  () => ({
    MobileHeroWorkflow: () => null,
  })
)

describe('HeroPlatformStage loading', () => {
  it('preloads only the desktop AVIF selection and keeps the hidden image lazy on mobile', () => {
    const html = renderToStaticMarkup(<HeroPlatformStage />)
    const preloads = html.match(/<link\b[^>]*rel="preload"[^>]*>/g) ?? []
    expect(preloads).toHaveLength(1)
    expect(preloads[0]).toContain('media="(min-width: 1024px)"')
    expect(preloads[0]).toContain('type="image/avif"')
    expect(preloads[0]).toContain(`imageSrcSet="${HERO_ARTWORK.avifSrcSet}"`)
    expect(html).toContain(`srcSet="${HERO_ARTWORK.avifSrcSet}"`)
    expect(html).toContain(`srcSet="${HERO_ARTWORK.webpSrcSet}"`)
    expect(html).toContain('loading="lazy"')
    expect(html).not.toContain('/_next/image')
  })
})
