/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { IntegrationTabsHeader } from '@/app/workspace/[workspaceId]/components/integration-tabs-header/integration-tabs-header'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(active: 'integrations' | 'skills' = 'integrations') {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<IntegrationTabsHeader active={active} workspaceId='workspace-1' />))
}

function tabs(): string[] {
  return Array.from(container?.querySelectorAll('a') ?? []).map((node) => node.textContent ?? '')
}

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('IntegrationTabsHeader', () => {
  it('links every tab to its page in the routed workspace', () => {
    mount()

    expect(tabs()).toEqual(['Integrations', 'Skills'])
    expect(
      Array.from(container?.querySelectorAll('a') ?? []).map((node) => node.getAttribute('href'))
    ).toEqual(['/workspace/workspace-1/integrations', '/workspace/workspace-1/skills'])
  })

  it('keeps the same workspace navigation on the Skills tab', () => {
    mount('skills')
    expect(tabs()).toEqual(['Integrations', 'Skills'])
  })
})
