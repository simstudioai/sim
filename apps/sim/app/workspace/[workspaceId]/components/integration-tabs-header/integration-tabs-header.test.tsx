/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockMemberAccessAvailable } = vi.hoisted(() => ({
  mockMemberAccessAvailable: vi.fn(() => true),
}))

vi.mock('@/hooks/use-member-access', () => ({
  useMemberAccessAvailable: () => mockMemberAccessAvailable(),
}))

import { IntegrationTabsHeader } from '@/app/workspace/[workspaceId]/components/integration-tabs-header/integration-tabs-header'

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(active: 'integrations' | 'skills' | 'search' = 'integrations') {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<IntegrationTabsHeader active={active} workspaceId='workspace-1' />))
}

function tabs(): string[] {
  return Array.from(container?.querySelectorAll('a') ?? []).map((node) => node.textContent ?? '')
}

beforeEach(() => {
  mockMemberAccessAvailable.mockReturnValue(true)
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('IntegrationTabsHeader', () => {
  it('links every tab to its page in the routed workspace', () => {
    mount()

    expect(tabs()).toEqual(['Integrations', 'Skills', 'Search'])
    expect(
      Array.from(container?.querySelectorAll('a') ?? []).map((node) => node.getAttribute('href'))
    ).toEqual([
      '/workspace/workspace-1/integrations',
      '/workspace/workspace-1/skills',
      '/workspace/workspace-1/search',
    ])
  })

  it('omits Search where per-member access is off, matching the page that 404s', () => {
    mockMemberAccessAvailable.mockReturnValue(false)
    mount()

    expect(tabs()).toEqual(['Integrations', 'Skills'])
  })
})
