/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CUSTOMER_STORIES } from '@/lib/customers/data'
import { CustomerStoryMedia } from '@/app/(landing)/customers/components/customer-story-media/customer-story-media'

const exp = CUSTOMER_STORIES.find((story) => story.slug === 'exp-realty')!
const rivian = CUSTOMER_STORIES.find((story) => story.slug === 'rivian')!

describe('CustomerStoryMedia', () => {
  it('offers manual playback without loading or looping the film automatically', () => {
    const html = renderToStaticMarkup(<CustomerStoryMedia story={exp} playable />)

    expect(html).toContain('<video')
    expect(html).toContain('controls=""')
    expect(html).toContain('preload="none"')
    expect(html).toContain(`poster="${exp.heroVideo?.poster}"`)
    expect(html).toContain(`src="${exp.heroVideo?.src}"`)
    expect(html).toContain('aria-label="eXp Realty home preview"')
    expect(html).not.toMatch(/autoplay/i)
    expect(html).not.toContain('loop=""')
  })

  it('keeps cards static even when their story has a playable film', () => {
    const html = renderToStaticMarkup(<CustomerStoryMedia story={exp} />)

    expect(html).not.toContain('<video')
    expect(html).toContain(exp.logo.src)
  })

  it('keeps the artwork fallback for stories without video', () => {
    const html = renderToStaticMarkup(<CustomerStoryMedia story={rivian} playable />)

    expect(html).not.toContain('<video')
    expect(html).toContain(rivian.heroAlt)
  })
})
