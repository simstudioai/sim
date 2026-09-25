import { BlockTileView } from '@sim/workflow-renderer'
import { getWorkflowTypeAccent } from '@sim/workflow-renderer/workflow-type'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

const Icon = ({ className }: { className?: string }) => <svg className={className} />

describe('shared block tile', () => {
  it('preserves the state accent for both Human block versions', () => {
    expect(getWorkflowTypeAccent('human_in_the_loop_v2')).toEqual(
      getWorkflowTypeAccent('human_in_the_loop')
    )
    expect(getWorkflowTypeAccent('human_in_the_loop_v2').tone).toBe('yellow')
  })
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

  it('renders an inline provider tile inside native row buttons', () => {
    const inline = renderToStaticMarkup(
      <BlockTileView
        as='span'
        blockType='provider'
        icon={Icon}
        bgColor='#33C482'
        useAccent={false}
      />
    )
    const ordinary = renderToStaticMarkup(
      <BlockTileView blockType='provider' icon={Icon} bgColor='#33C482' useAccent={false} />
    )
    expect(inline).toMatch(/^<span\b/)
    expect(ordinary).toMatch(/^<div\b/)
    expect(inline.replace(/^<span/, '<div').replace(/<\/span>$/, '</div>')).toBe(ordinary)
  })
})
