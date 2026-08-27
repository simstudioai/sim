/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  ChipModal: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role='dialog'>{children}</div> : null,
  ChipModalBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChipModalHeader: ({ children, onClose }: { children: ReactNode; onClose: () => void }) => (
    <header>
      {children}
      <button type='button' onClick={onClose}>
        Close
      </button>
    </header>
  ),
}))

import { MicrophonePermissionHelp } from '@/app/workspace/[workspaceId]/home/components/user-input/components/microphone-permission-help/microphone-permission-help'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderPermissionHelp(onOpenChange = vi.fn()) {
  act(() => root.render(<MicrophonePermissionHelp open onOpenChange={onOpenChange} />))
  return onOpenChange
}

describe('MicrophonePermissionHelp', () => {
  it('explains how to recover blocked browser microphone access', () => {
    renderPermissionHelp()

    expect(container.textContent).toContain('Open the site controls beside the address bar.')
    expect(container.textContent).toContain('Set Microphone access for this site to Allow.')
    expect(container.textContent).toContain('Safari Settings')
  })

  it('closes from the header action', () => {
    const onOpenChange = renderPermissionHelp()
    const closeButton = container.querySelector('button')

    act(() => closeButton?.click())

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
