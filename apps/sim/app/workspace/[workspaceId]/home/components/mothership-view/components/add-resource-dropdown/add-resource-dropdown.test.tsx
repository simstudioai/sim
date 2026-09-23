/** @vitest-environment jsdom */
import { act } from 'react'
import { sleep } from '@sim/utils/helpers'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddResourceDropdown } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/add-resource-dropdown'

const { inventories, workspaces } = vi.hoisted(() => {
  const inventory = (name: string) => ({
    groups: [{ type: 'workflow', items: [{ id: 'shared-alias', name }] }],
    structureFolders: { table: [], knowledgebase: [] },
    isHydrating: false,
  })
  return {
    inventories: {
      a: inventory('Orion acceptance A'),
      b: inventory('Orion acceptance B'),
      empty: { groups: [], structureFolders: { table: [], knowledgebase: [] }, isHydrating: false },
    },
    workspaces: [
      { id: 'a', name: 'Workspace A', organizationId: 'org' },
      { id: 'b', name: 'Workspace B', organizationId: 'org' },
      { id: 'excluded', name: 'Other organization', organizationId: 'other' },
    ],
  }
})
vi.mock('@/lib/browser-agent/transport', () => ({ isBrowserAgentAvailable: () => false }))
vi.mock('@/lib/terminal/transport', () => ({ isTerminalAvailable: () => false }))
vi.mock('@/hooks/queries/workspace', () => ({ useWorkspacesQuery: () => ({ data: workspaces }) }))
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown/available-resources',
  () => ({
    BROWSER_LAUNCHER_ID: 'browser',
    TERMINAL_LAUNCHER_ID: 'terminal',
    useAvailableResources: (workspaceId: string) =>
      inventories[workspaceId as 'a' | 'b'] ?? inventories.empty,
  })
)
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-registry',
  () => ({
    byResourceMenuOrder: () => 0,
    getResourceConfig: () => ({
      label: 'Workflows',
      icon: () => null,
      renderDropdownItem: ({ item }: { item: { name: string } }) => <span>{item.name}</span>,
    }),
  })
)

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
})

function findRow(text: string): HTMLElement {
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
    (item) => item.textContent?.includes(text)
  )
  if (!item) throw new Error(`Missing menu row: ${text}`)
  return item
}

async function openMenu(onAdd = vi.fn()) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<AddResourceDropdown organizationId='org' onAdd={onAdd} />))
  const trigger = document.querySelector<HTMLElement>('[aria-label="Add resource tab"]')!
  act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await act(async () => sleep(1))
  return onAdd
}

describe('organization resource menu', () => {
  it.each(['A', 'B'])(
    'searches both inventories at the root and preserves workspace %s on selection',
    async (owner) => {
      const onAdd = await openMenu()
      expect(document.body.textContent).not.toContain('Other organization')
      const input = document.querySelector<HTMLInputElement>(
        'input[placeholder="Search resources..."]'
      )!
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          input,
          'Orion'
        )
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      expect(findRow('Orion acceptance A').textContent).toContain('Workspace A')
      expect(findRow('Orion acceptance B').textContent).toContain('Workspace B')
      await act(async () => findRow(`Orion acceptance ${owner}`).click())
      expect(onAdd).toHaveBeenCalledExactlyOnceWith({
        type: 'workflow',
        id: 'shared-alias',
        title: `Orion acceptance ${owner}`,
        workspaceId: owner.toLowerCase(),
      })
      expect(document.querySelector('[role="menu"]')).toBeNull()
    }
  )

  it('keeps workspace and Workflows submenus open until selecting a leaf', async () => {
    const onAdd = await openMenu()
    act(() => findRow('Workspace B').click())
    await act(async () => sleep(1))
    expect(document.querySelectorAll('input[placeholder="Search resources..."]')).toHaveLength(1)
    act(() => {
      const row = findRow('Workflows')
      row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }))
      row.focus()
      row.click()
    })
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(3)
    expect(onAdd).not.toHaveBeenCalled()
    await act(async () => findRow('Orion acceptance B').click())
    expect(onAdd).toHaveBeenCalledExactlyOnceWith({
      type: 'workflow',
      id: 'shared-alias',
      title: 'Orion acceptance B',
      workspaceId: 'b',
    })
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })
})
