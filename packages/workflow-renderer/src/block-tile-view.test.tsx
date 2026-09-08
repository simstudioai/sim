import { BlockTileView } from '@sim/workflow-renderer'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

const Icon = ({ className }: { className?: string }) => <svg className={className} />

describe('shared block tile', () => {
  it('uses the same role accent and header dimensions for a core block', () => {
    const html = renderToStaticMarkup(
      <BlockTileView blockType='agent' icon={Icon} bgColor='#33C482' useAccent size='lg' />
    )
    expect(html).toContain('data-workflow-type-icon="agent"')
    expect(html).toContain('size-[18px]')
    expect(html).toContain('size-[12px]')
    expect(html).not.toContain('background:')
  })

  it.each([
    { color: '#FFFFFF', foreground: 'text-black!' },
    { color: '#111111', foreground: 'text-white!' },
    { color: 'linear-gradient(#E0F7FA, #FFFFFF)', foreground: 'text-black!' },
  ])('keeps provider icons legible on $color', ({ color, foreground }) => {
    const html = renderToStaticMarkup(
      <BlockTileView blockType='provider' icon={Icon} bgColor={color} useAccent={false} />
    )
    expect(html).toContain(foreground)
    expect(html).toContain('background:')
    expect(html).not.toContain('data-workflow-type-icon')
  })

  it('preserves fallback labels and caller accessibility attributes', () => {
    const html = renderToStaticMarkup(
      <BlockTileView
        bgColor='#FFFFFF'
        fallbackLabel='A'
        useAccent={false}
        aria-label='Example provider'
      />
    )
    expect(html).toContain('aria-label="Example provider"')
    expect(html).toContain('text-black!')
    expect(html).toContain('>A</span>')
  })
})
