/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** The queued message renders its content through the real block registry. */
vi.unmock('@/blocks/registry')

import { QueuedMessages } from '@/app/workspace/[workspaceId]/home/components/queued-messages/queued-messages'

const mounted: Array<() => void> = []

/** jsdom has no ResizeObserver; the queue measures its width with one. */
class ResizeObserverMock {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

function renderQueue(admissionUnknown: boolean) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const onEdit = vi.fn()
  act(() => {
    root.render(
      <QueuedMessages
        messageQueue={[{ id: 'held-first', content: 'inspect the workspace', admissionUnknown }]}
        editingQueuedId={null}
        dispatchingHeadId={null}
        onRemove={() => {}}
        onSendNow={async () => {}}
        onEdit={onEdit}
        onCancelEdit={() => {}}
      />
    )
  })
  mounted.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  const editButton = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Edit queued message"], button[aria-label^="May already be sent"]'
  )
  if (!editButton) throw new Error('Edit button not rendered')
  return { editButton, onEdit }
}

describe('QueuedMessages edit button', () => {
  afterEach(() => {
    for (const unmount of mounted.splice(0)) unmount()
  })

  it('keeps a message that may already be sent from being edited, and says why', () => {
    const { editButton, onEdit } = renderQueue(true)

    /** Still focusable and hoverable, so its tooltip can explain why. */
    expect(editButton.disabled).toBe(false)
    expect(editButton.getAttribute('aria-disabled')).toBe('true')
    expect(editButton.getAttribute('aria-label')).toBe(
      'May already be sent; editing could send a second message'
    )
    act(() => editButton.click())
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('edits an ordinary queued message', () => {
    const { editButton, onEdit } = renderQueue(false)

    act(() => editButton.click())
    expect(onEdit).toHaveBeenCalledWith('held-first')
  })
})
