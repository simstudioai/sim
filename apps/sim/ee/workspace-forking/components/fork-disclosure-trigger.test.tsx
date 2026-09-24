/**
 * @vitest-environment jsdom
 */
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ForkDisclosureTrigger } from '@/ee/workspace-forking/components/fork-disclosure-trigger'

let container: HTMLDivElement
let root: Root

function Disclosures() {
  const [resourcesOpen, setResourcesOpen] = useState(false)
  const [mappingOpen, setMappingOpen] = useState(true)

  return (
    <>
      <ForkDisclosureTrigger
        label='Workflows (2)'
        expanded={resourcesOpen}
        onToggle={() => setResourcesOpen((value) => !value)}
        className='min-w-0 flex-1 gap-1'
        labelClassName='flex-1'
      />
      <ForkDisclosureTrigger
        label='Credentials'
        expanded={mappingOpen}
        onToggle={() => setMappingOpen((value) => !value)}
        className='w-full gap-2'
        trailing={<span>Needs review</span>}
      />
    </>
  )
}

describe('ForkDisclosureTrigger', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(<Disclosures />))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('keeps each native disclosure button independent and announces its current state', () => {
    const [resources, mapping] = Array.from(container.querySelectorAll('button'))
    expect(resources?.getAttribute('aria-expanded')).toBe('false')
    expect(mapping?.getAttribute('aria-expanded')).toBe('true')
    expect(resources?.textContent).toContain('Workflows (2)')
    expect(mapping?.textContent).toContain('CredentialsNeeds review')

    act(() => resources?.click())
    expect(resources?.getAttribute('aria-expanded')).toBe('true')
    expect(mapping?.getAttribute('aria-expanded')).toBe('true')

    act(() => mapping?.click())
    expect(resources?.getAttribute('aria-expanded')).toBe('true')
    expect(mapping?.getAttribute('aria-expanded')).toBe('false')
  })
})
