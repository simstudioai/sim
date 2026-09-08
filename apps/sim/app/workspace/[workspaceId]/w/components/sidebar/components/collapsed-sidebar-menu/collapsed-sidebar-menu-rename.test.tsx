/**
 * @vitest-environment jsdom
 */
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/w/components/sidebar/components/chat-navigation-link/chat-navigation-link',
  () => ({
    ChatNavigationLink: ({
      chatId: _chatId,
      isCurrentRoute: _isCurrentRoute,
      ...props
    }: React.ComponentProps<'a'> & { chatId: string; isCurrentRoute: boolean }) => <a {...props} />,
  })
)

import {
  CollapsedChatFlyoutItem,
  CollapsedFolderItems,
  CollapsedSidebarMenu,
  CollapsedWorkflowFlyoutItem,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/collapsed-sidebar-menu'
import { useFlyoutInlineRename } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-flyout-inline-rename'
import { useHoverMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-hover-menu'
import type { FolderTreeNode } from '@/stores/folders/types'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

const workflows: WorkflowMetadata[] = ['Alpha', 'Bravo'].map((name, index) => ({
  id: `workflow-${index}`,
  name,
  createdAt: new Date('2026-09-08'),
  lastModified: new Date('2026-09-08'),
  sortOrder: index,
}))

const folder: FolderTreeNode = {
  id: 'folder-1',
  name: 'Folder',
  resourceType: 'workflow',
  workspaceId: 'workspace-1',
  userId: 'user-1',
  parentId: null,
  locked: false,
  sortOrder: 0,
  createdAt: new Date('2026-09-08'),
  updatedAt: new Date('2026-09-08'),
  children: [],
  level: 0,
}

interface RenameHarnessProps {
  onSave: (id: string, name: string) => Promise<void>
  nested?: boolean
  chat?: boolean
}

function RenameHarness({ onSave, nested = false, chat = false }: RenameHarnessProps) {
  const hover = useHoverMenu()
  const rename = useFlyoutInlineRename({ itemType: 'workflow', onSave })

  useEffect(() => {
    hover.setLocked(!!rename.editingId)
  }, [hover.setLocked, rename.editingId])

  function startRename(target: { id: string; name: string }) {
    hover.setLocked(true)
    rename.startRename(target)
  }

  return (
    <>
      <button type='button'>Outside</button>
      <CollapsedSidebarMenu
        hover={hover}
        icon='W'
        ariaLabel='Workflows'
        isEditing={!!rename.editingId}
      >
        {nested ? (
          <CollapsedFolderItems
            nodes={[folder]}
            workflowsByFolder={{ [folder.id]: workflows }}
            workspaceId='workspace-1'
            editingWorkflowId={rename.editingId}
            editingValue={rename.value}
            editInputRef={rename.inputRef}
            isRenamingWorkflow={rename.isSaving}
            onEditValueChange={rename.setValue}
            onEditKeyDown={rename.handleKeyDown}
            onEditBlur={rename.saveRename}
            onWorkflowRename={startRename}
          />
        ) : (
          workflows.map((workflow) =>
            chat ? (
              <CollapsedChatFlyoutItem
                key={workflow.id}
                chat={{ ...workflow, href: `/chat/${workflow.id}` }}
                isCurrentRoute={false}
                isEditing={rename.editingId === workflow.id}
                editValue={rename.value}
                inputRef={rename.inputRef}
                isRenaming={rename.isSaving}
                onEditValueChange={rename.setValue}
                onEditKeyDown={rename.handleKeyDown}
                onEditBlur={rename.saveRename}
                onMoreClick={() => startRename(workflow)}
              />
            ) : (
              <CollapsedWorkflowFlyoutItem
                key={workflow.id}
                workflow={workflow}
                href={`/w/${workflow.id}`}
                isEditing={rename.editingId === workflow.id}
                editValue={rename.value}
                inputRef={rename.inputRef}
                isRenaming={rename.isSaving}
                onEditValueChange={rename.setValue}
                onEditKeyDown={rename.handleKeyDown}
                onEditBlur={rename.saveRename}
                onRename={() => startRename(workflow)}
              />
            )
          )
        )}
      </CollapsedSidebarMenu>
    </>
  )
}

function getElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing element: ${selector}`)
  return element
}

function pointerEvent(target: HTMLElement, type: string, relatedTarget?: HTMLElement) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, relatedTarget })
  Object.defineProperty(event, 'pointerType', { value: 'mouse' })
  act(() => target.dispatchEvent(event))
}

async function flushTimers(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function pressKey(target: HTMLElement, key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  act(() => target.dispatchEvent(event))
  await flushTimers()
  return event
}

function changeValue(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('collapsed flyout rename focus', () => {
  let container: HTMLDivElement
  let root: Root
  let onSave: ReturnType<typeof vi.fn<RenameHarnessProps['onSave']>>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onSave = vi.fn().mockResolvedValue(undefined)
  })

  afterEach(async () => {
    act(() => root.unmount())
    await flushTimers()
    container.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function renderFlyout(options: Omit<RenameHarnessProps, 'onSave'> = {}) {
    await act(async () => root.render(<RenameHarness onSave={onSave} {...options} />))
    const trigger = getElement<HTMLButtonElement>('[aria-label="Workflows"]')
    act(() => trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    await flushTimers()
    if (options.nested) {
      act(() => getElement<HTMLElement>('[role="menuitem"][aria-haspopup="menu"]').click())
      await flushTimers()
    }
  }

  async function startRename(options: Omit<RenameHarnessProps, 'onSave'> = {}) {
    await renderFlyout(options)
    act(() =>
      getElement<HTMLButtonElement>(
        options.chat ? '[aria-label="Chat options"]' : '[aria-label="Workflow options"]'
      ).click()
    )
    await flushTimers()
    if (!options.chat) {
      const rename = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
        (item) => item.textContent === 'Rename'
      )
      if (!rename) throw new Error('Rename action not rendered')
      act(() => rename.click())
      await flushTimers()
    }
    const input = getElement<HTMLInputElement>('input[aria-label^="Rename"]')
    expect(document.activeElement).toBe(input)
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'Alpha'.length])
    return input
  }

  it.each([{ nested: false }, { nested: true }, { chat: true }])(
    'keeps focus when typing a letter matching another row: %j',
    async (options) => {
      const input = await startRename(options)
      await pressKey(input, 'b')
      expect(document.activeElement).toBe(input)
      expect(input.isConnected).toBe(true)
      expect(onSave).not.toHaveBeenCalled()
    }
  )

  it('lets Left Arrow move the caret without closing the folder', async () => {
    const input = await startRename({ nested: true })
    const event = await pressKey(input, 'ArrowLeft')
    expect(event.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(input)
    expect(input.isConnected).toBe(true)
  })

  it('keeps focus when the pointer leaves the parent folder trigger', async () => {
    const input = await startRename({ nested: true })
    const folderTrigger = getElement<HTMLElement>('[role="menuitem"][aria-haspopup="menu"]')
    pointerEvent(folderTrigger, 'pointerout', input)
    await flushTimers()
    expect(document.activeElement).toBe(input)
    expect(input.isConnected).toBe(true)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('allows Tab to leave the input instead of trapping it in the menu', async () => {
    const input = await startRename()
    const event = await pressKey(input, 'Tab')
    expect(event.defaultPrevented).toBe(false)
  })

  it.each([{ nested: false }, { nested: true }, { chat: true }])(
    'keeps the draft focused when the pointer crosses another row: %j',
    async (options) => {
      const input = await startRename(options)
      changeValue(input, 'Draft name')
      const other = getElement<HTMLAnchorElement>('a[href$="workflow-1"]')
      pointerEvent(other, 'pointermove')
      await flushTimers()
      expect(document.activeElement).toBe(input)
      expect(onSave).not.toHaveBeenCalled()
      expect(input.value).toBe('Draft name')
    }
  )

  it('saves once on Enter, including a blur while the save is pending', async () => {
    let resolveSave!: () => void
    onSave.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve
        })
    )
    const input = await startRename()
    changeValue(input, '  New name  ')
    await pressKey(input, 'Enter')
    act(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(onSave).toHaveBeenCalledExactlyOnceWith('workflow-0', 'New name')
    expect(input.disabled).toBe(true)
    await act(async () => resolveSave())
    expect(input.isConnected).toBe(false)
  })

  it('cancels with Escape without saving the draft', async () => {
    const input = await startRename({ nested: true })
    changeValue(input, 'Draft name')
    await pressKey(input, 'Escape')
    expect(input.isConnected).toBe(false)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves when focus deliberately moves outside', async () => {
    const input = await startRename()
    changeValue(input, 'New name')
    await act(async () => getElement<HTMLButtonElement>('button').focus())
    expect(onSave).toHaveBeenCalledExactlyOnceWith('workflow-0', 'New name')
    expect(input.isConnected).toBe(false)
  })

  it.each(['', '   ', 'Alpha', ' Alpha '])(
    'does not save an empty or unchanged name: %j',
    async (value) => {
      const input = await startRename()
      changeValue(input, value)
      await pressKey(input, 'Enter')
      expect(input.isConnected).toBe(false)
      expect(onSave).not.toHaveBeenCalled()
    }
  )

  it('allows retry after a failed save', async () => {
    onSave.mockRejectedValueOnce(new Error('Rename failed'))
    const input = await startRename()
    changeValue(input, 'New name')
    await pressKey(input, 'Enter')
    expect(input.isConnected).toBe(true)
    expect(input.disabled).toBe(false)
    expect(input.value).toBe('Alpha')
    act(() => input.focus())
    changeValue(input, 'Retry name')
    await pressKey(input, 'Enter')
    expect(onSave).toHaveBeenCalledTimes(2)
    expect(onSave).toHaveBeenLastCalledWith('workflow-0', 'Retry name')
    expect(input.isConnected).toBe(false)
  })

  it('holds the flyout open on mouse leave only until editing ends', async () => {
    const input = await startRename()
    const trigger = getElement<HTMLElement>('[aria-label="Workflows"]')
    act(() => trigger.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))
    await flushTimers(200)
    expect(document.activeElement).toBe(input)
    expect(input.isConnected).toBe(true)
    await pressKey(input, 'Escape')
    await flushTimers(200)
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })

  it('restores hover navigation after cancelling a rename', async () => {
    const input = await startRename()
    await pressKey(input, 'Escape')
    const other = getElement<HTMLAnchorElement>('a[href$="workflow-1"]')
    pointerEvent(other, 'pointermove')
    expect(document.activeElement).toBe(other)
  })

  it('keeps clicking a different workflow available during a rename', async () => {
    const input = await startRename()
    changeValue(input, 'New name')
    const other = getElement<HTMLAnchorElement>('a[href$="workflow-1"]')
    const navigate = vi.fn((event: Event) => event.preventDefault())
    other.addEventListener('click', navigate)
    pointerEvent(other, 'pointerdown')
    act(() => other.focus())
    act(() => other.click())
    await flushTimers()
    expect(navigate).toHaveBeenCalledOnce()
    expect(onSave).toHaveBeenCalledExactlyOnceWith('workflow-0', 'New name')
  })

  it('preserves the input, draft, and selection across a parent rerender', async () => {
    const input = await startRename()
    changeValue(input, 'Draft name')
    input.setSelectionRange(2, 5)
    await act(async () => root.render(<RenameHarness onSave={onSave} />))
    expect(getElement('input[aria-label^="Rename"]')).toBe(input)
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('Draft name')
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5])
  })

  it('retains normal typeahead and pointer navigation outside rename mode', async () => {
    await renderFlyout()
    const menu = getElement<HTMLElement>('[role="menu"]')
    const first = getElement<HTMLAnchorElement>('a[href$="workflow-0"]')
    const second = getElement<HTMLAnchorElement>('a[href$="workflow-1"]')
    await pressKey(menu, 'b')
    expect(document.activeElement).toBe(second)
    pointerEvent(first, 'pointermove')
    expect(document.activeElement).toBe(first)
  })
})
