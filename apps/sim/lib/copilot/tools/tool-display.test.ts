/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getToolDisplayTitle, mvDisplayVerb } from './tool-display'

describe('mvDisplayVerb', () => {
  it('reads a leaf-only change in the same folder as a rename', () => {
    expect(mvDisplayVerb('workflows/falling-vacuum', 'workflows/failing-vacuum')).toBe('Renaming')
    expect(mvDisplayVerb('files/Reports/a.md', 'files/Reports/b.md')).toBe('Renaming')
    expect(mvDisplayVerb('tables/Leads', 'tables/Customers')).toBe('Renaming')
  })

  it('decodes segments so encoded sources compare against plain destinations', () => {
    expect(mvDisplayVerb('workflows/My%20Flow', 'workflows/New Flow')).toBe('Renaming')
    expect(mvDisplayVerb('files/My%20Docs/a.md', 'files/My Docs/b.md')).toBe('Renaming')
  })

  it('reads parent changes and folder destinations as moves', () => {
    expect(mvDisplayVerb('files/a.png', 'files/Images/')).toBe('Moving')
    expect(mvDisplayVerb('files/Reports/a.md', 'files/Archive/a.md')).toBe('Moving')
    expect(mvDisplayVerb('files/Reports/a.md', 'files/Archive/b.md')).toBe('Moving')
    expect(mvDisplayVerb('workflows/My Flow', 'workflows/Archive/')).toBe('Moving')
  })

  it('falls back to Moving when arguments are incomplete', () => {
    expect(mvDisplayVerb(undefined, 'files/x.md')).toBe('Moving')
    expect(mvDisplayVerb('files/x.md', undefined)).toBe('Moving')
  })
})

describe('getToolDisplayTitle for the vfs verbs', () => {
  it('uses the derived verb for mv titles', () => {
    expect(
      getToolDisplayTitle('mv', {
        sources: ['workflows/falling-vacuum'],
        destination: 'workflows/failing-vacuum',
        toolTitle: 'falling-vacuum to failing-vacuum',
      })
    ).toBe('Renaming falling-vacuum to failing-vacuum')
    expect(
      getToolDisplayTitle('mv', {
        sources: ['files/a.png', 'files/b.png'],
        destination: 'files/Images/',
        toolTitle: '2 files to Images',
      })
    ).toBe('Moving 2 files to Images')
  })

  it('titles cp and mkdir by intent', () => {
    expect(getToolDisplayTitle('cp', { toolTitle: 'My Workflow' })).toBe('Duplicating My Workflow')
    expect(getToolDisplayTitle('mkdir', { toolTitle: 'Reports/2026' })).toBe(
      'Creating Reports/2026'
    )
    expect(getToolDisplayTitle('cp', {})).toBe('Duplicating workflow')
    expect(getToolDisplayTitle('mkdir', {})).toBe('Creating folder')
  })
})

describe('getToolDisplayTitle for request-scoped MCP tools', () => {
  it('hides the internal server id and humanizes the tool name', () => {
    expect(getToolDisplayTitle('mcp-363de040-web_search_exa')).toBe('Web Search Exa')
  })
})
