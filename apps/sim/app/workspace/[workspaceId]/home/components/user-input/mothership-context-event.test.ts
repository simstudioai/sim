/**
 * @vitest-environment jsdom
 */
import { afterEach, expect, it, vi } from 'vitest'
import {
  MOTHERSHIP_ADD_CONTEXT_EVENT,
  type MothershipAddContextDetail,
} from '@/lib/mothership/events'
import { handleMothershipAddContextEvent } from '@/app/workspace/[workspaceId]/home/components/user-input/mothership-context-event'

afterEach(() => vi.restoreAllMocks())

function mockEditor() {
  return {
    insertContext: vi.fn(),
    insertContextChips: vi.fn(),
    focusAtEnd: vi.fn(),
    textareaRef: { current: { focus: vi.fn() } as unknown as HTMLTextAreaElement },
  }
}

it('claims a context event, inserts it, and restores composer focus on the next frame', () => {
  const context = {
    kind: 'browser_tab' as const,
    tabId: 'tab-1',
    label: 'Browser',
    selection: { text: 'selected text', url: 'https://example.com' },
  }
  const event = new CustomEvent<MothershipAddContextDetail>(MOTHERSHIP_ADD_CONTEXT_EVENT, {
    detail: { context },
    cancelable: true,
  })
  const editor = mockEditor()
  let focusFrame: FrameRequestCallback | undefined
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    focusFrame = callback
    return 1
  })

  expect(handleMothershipAddContextEvent(event, editor)).toBe(true)
  expect(event.defaultPrevented).toBe(true)
  expect(editor.insertContext).toHaveBeenCalledWith(context)
  expect(editor.focusAtEnd).not.toHaveBeenCalled()

  focusFrame?.(0)
  expect(editor.focusAtEnd).toHaveBeenCalledOnce()
})

it('claims a batch event, inserts the chips at the caret, and focuses synchronously', () => {
  const contexts = [
    { kind: 'file_selection' as const, label: 'notes.md:12-40', fileId: 'f1' },
    { kind: 'table_selection' as const, label: 'Sales (2 rows)', tableId: 't1' },
  ]
  const event = new CustomEvent<MothershipAddContextDetail>(MOTHERSHIP_ADD_CONTEXT_EVENT, {
    detail: { contexts },
    cancelable: true,
  })
  const editor = mockEditor()

  expect(handleMothershipAddContextEvent(event, editor)).toBe(true)
  expect(event.defaultPrevented).toBe(true)
  expect(editor.insertContextChips).toHaveBeenCalledWith(contexts)
  expect(editor.textareaRef.current?.focus).toHaveBeenCalledOnce()
  expect(editor.insertContext).not.toHaveBeenCalled()
})

it('does not let a second composer claim an event already handled elsewhere', () => {
  const event = new CustomEvent<MothershipAddContextDetail>(MOTHERSHIP_ADD_CONTEXT_EVENT, {
    detail: {
      context: {
        kind: 'browser_tab',
        tabId: 'tab-1',
        label: 'Browser',
        selection: { text: 'selected text' },
      },
    },
    cancelable: true,
  })
  event.preventDefault()
  const editor = mockEditor()

  expect(handleMothershipAddContextEvent(event, editor)).toBe(false)
  expect(editor.insertContext).not.toHaveBeenCalled()
  expect(editor.insertContextChips).not.toHaveBeenCalled()
})
