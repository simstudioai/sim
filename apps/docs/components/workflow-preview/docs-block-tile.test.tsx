/** @vitest-environment node */
import { CirclePause, Clock, Webhook } from '@sim/emcn/icons'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { normalizeBlockType, resolveIcon } from '@/components/workflow-preview/block-icons'
import { BlockInspector } from '@/components/workflow-preview/block-inspector'
import { DocsBlockTile } from '@/components/workflow-preview/docs-block-tile'

describe('docs editor presentation', () => {
  it('uses generated registry glyphs for Wait, Schedule, and incoming webhooks', () => {
    expect(resolveIcon('wait')).toBe(CirclePause)
    expect(resolveIcon('schedule')).toBe(Clock)
    expect(resolveIcon(normalizeBlockType('webhook', true))).toBe(Webhook)
    expect(resolveIcon('webhook')).not.toBe(Webhook)
  })

  it('applies the editor role tile to core blocks and provider contrast to integrations', () => {
    const core = renderToStaticMarkup(<DocsBlockTile type='agent' color='#33C482' />)
    expect(core).toContain('data-workflow-type-icon="agent"')
    const provider = renderToStaticMarkup(<DocsBlockTile type='notion' color='#FFFFFF' />)
    expect(provider).toContain('text-black!')
    expect(provider).not.toContain('data-workflow-type-icon')
  })

  it('shares editor reference formatting in text and selector fields without adding edit controls', () => {
    const html = renderToStaticMarkup(
      <BlockInspector
        name='Reply'
        type='agent'
        fields={[
          { label: 'Messages', kind: 'textarea', value: 'Reply to <start.input>' },
          { label: 'Workflow', kind: 'select', value: '<variable.workflow>' },
        ]}
      />
    )
    expect(html).toContain('text-[var(--brand-secondary)]')
    expect(html).toContain('&lt;start.input&gt;')
    expect(html).toContain('&lt;variable.workflow&gt;')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('<button')
  })
})
