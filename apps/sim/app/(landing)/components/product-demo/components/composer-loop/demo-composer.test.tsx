/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  COMPOSER_ACTIONS,
  DemoComposer,
} from '@/app/(landing)/components/product-demo/components/composer-loop/demo-composer'

describe('DemoComposer', () => {
  it('rests on the initial placeholder with the product toolbar', () => {
    const html = renderToStaticMarkup(<DemoComposer prompt='' isSending={false} isInitialView />)

    expect(html).toContain('Ask Sim to')
    for (const action of COMPOSER_ACTIONS) {
      expect(html).toContain(`data-action="${action}"`)
    }
    expect(html).toContain('bg-[#808080]')
  })

  it('shows the typed prompt and arms the send disc', () => {
    const html = renderToStaticMarkup(
      <DemoComposer prompt='Turn my launch notes' isSending={false} isInitialView />
    )

    expect(html).toContain('Turn my launch notes')
    expect(html).toContain('bg-[#383838]')
    expect(html).not.toContain('fill-white')
  })

  it('switches to the conversation placeholder and the stop square while sending', () => {
    const html = renderToStaticMarkup(<DemoComposer prompt='' isSending isInitialView={false} />)

    expect(html).toContain('Send message to Sim')
    expect(html).toContain('fill-white')
  })

  it('separates the placeholder and the typed prompt by token', () => {
    const resting = renderToStaticMarkup(<DemoComposer prompt='' isSending={false} isInitialView />)
    const typed = renderToStaticMarkup(
      <DemoComposer prompt='Enrich every new lead' isSending={false} isInitialView />
    )

    expect(resting).toContain('text-[var(--text-muted)]')
    expect(typed).toContain('text-[var(--text-primary)]')
    expect(typed).not.toContain('text-[var(--text-muted)]')
  })

  it('leads the empty field with the caret and trails the typed prompt with it', () => {
    const resting = renderToStaticMarkup(
      <DemoComposer prompt='' isSending={false} isInitialView caret />
    )
    const typed = renderToStaticMarkup(
      <DemoComposer prompt='Enrich every new lead' isSending={false} isInitialView caret />
    )

    expect(resting.indexOf('animate-caret-blink')).toBeLessThan(resting.indexOf('Ask Sim to'))
    expect(typed.indexOf('animate-caret-blink')).toBeGreaterThan(typed.indexOf('Enrich every'))
  })

  it('draws the product resting chrome only under fullChrome', () => {
    const compact = renderToStaticMarkup(<DemoComposer prompt='' isSending={false} isInitialView />)
    const full = renderToStaticMarkup(
      <DemoComposer prompt='' isSending={false} isInitialView fullChrome />
    )

    expect(compact).not.toContain('min-h-[56px]')
    expect(compact).not.toContain('Build')
    expect(full).toContain('min-h-[56px]')
    expect(full).toContain('Build')
  })

  it('keeps every control out of the tab order', () => {
    const html = renderToStaticMarkup(
      <DemoComposer prompt='' isSending={false} isInitialView fullChrome />
    )

    expect(html).not.toContain('<button')
    expect(html).not.toContain('tabindex')
  })
})
