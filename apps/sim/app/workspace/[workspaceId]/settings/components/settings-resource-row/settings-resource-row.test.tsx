/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row/settings-resource-row'

describe('SettingsResourceRow', () => {
  it('renders a real Next link beside interactive trailing controls', () => {
    const html = renderToStaticMarkup(
      <SettingsResourceRow
        title='Knowledge base'
        description='Connected resource'
        href='/workspace/example/knowledge'
        clickLabel='Open knowledge base'
        navigable
        trailing={<button type='button'>More actions</button>}
      />
    )
    const container = document.createElement('div')
    container.innerHTML = html

    const link = container.querySelector('a')
    const action = container.querySelector('button')
    expect(link?.getAttribute('href')).toBe('/workspace/example/knowledge')
    expect(link?.getAttribute('aria-label')).toBe('Open knowledge base')
    expect(link?.getAttribute('aria-describedby')).toBe(container.querySelector('span[id]')?.id)
    expect(link?.contains(action ?? null)).toBe(false)
    expect(action?.textContent).toBe('More actions')
  })
})
