/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}))

import { WorkspaceControls } from '@/app/(landing)/components/security/components/workspace-controls/workspace-controls'

describe('WorkspaceControls', () => {
  it('renders six untitled controls on an even three-column grid', () => {
    const html = renderToStaticMarkup(<WorkspaceControls />)

    expect(html).toContain('id="controls"')
    expect(html).toContain('aria-label="Workspace controls"')
    expect(html).toContain('grid-cols-3')
    expect(html).toContain('max-lg:grid-cols-2')
    expect(html).toContain('max-sm:grid-cols-1')
    expect(html.match(/<li /g)).toHaveLength(6)
    expect(html).toContain('>SSO &amp; SCIM</h3>')
    expect(html).toContain('>Self-hosting</h3>')
    expect(html).not.toContain('Open source')
  })

  it('shifts every mark off the 64-grid origin so its stroke sits flush with the text', () => {
    const html = renderToStaticMarkup(<WorkspaceControls />)
    const viewBoxes = [...html.matchAll(/viewBox="([^"]+)"/g)].map(([, value]) => value)

    expect(viewBoxes).toHaveLength(6)
    for (const viewBox of viewBoxes) {
      const [minX] = viewBox.split(' ').map(Number)
      expect(minX).toBeGreaterThan(12)
    }
  })

  it('carries no heading of its own', () => {
    const html = renderToStaticMarkup(<WorkspaceControls />)

    expect(html).not.toContain('How the workspace runs')
    expect(html).not.toContain('<h2')
  })
})
