/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DropboxIcon } from '@/components/icons'
import { OAUTH_PROVIDERS } from '@/lib/oauth'
import { BrandIcon, withBrandIcon } from '@/blocks/brand-icon'
import { getAllBlocks } from '@/blocks/registry'

vi.mocked(getAllBlocks).mockReturnValue([
  { icon: DropboxIcon, iconColor: '#0061FF' },
] as unknown as ReturnType<typeof getAllBlocks>)

interface PlainIconProps {
  className?: string
}

function PlainIcon({ className }: PlainIconProps) {
  return <svg className={className} />
}

describe('BrandIcon', () => {
  it('tints a registered brand glyph with its block color', () => {
    const markup = renderToStaticMarkup(<BrandIcon icon={DropboxIcon} className='size-[16px]' />)

    expect(markup).toContain('color:#0061FF')
    expect(markup).toContain('size-[16px]')
  })

  it('falls back to the muted icon token when no brand color is registered', () => {
    const markup = renderToStaticMarkup(<BrandIcon icon={PlainIcon} />)

    expect(markup).not.toContain('color:')
    expect(markup).toContain('text-[var(--text-icon)]')
  })

  it('gives an OAuth connect surface the color the chat surfaces already use', () => {
    const serviceIcon = OAUTH_PROVIDERS.dropbox.services.dropbox.icon
    const markup = renderToStaticMarkup(<BrandIcon icon={serviceIcon} />)

    expect(markup).toContain('color:#0061FF')
  })
})

describe('withBrandIcon', () => {
  it('returns a stable component per icon so an icon slot never remounts', () => {
    expect(withBrandIcon(DropboxIcon)).toBe(withBrandIcon(DropboxIcon))
    expect(withBrandIcon(PlainIcon)).not.toBe(withBrandIcon(DropboxIcon))
  })
})
