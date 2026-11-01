/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import type { BrowserPagePrompt } from '@sim/browser-protocol'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserPagePromptModal } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-page-prompt'

const mountedRoots: Root[] = []

function renderPrompt(prompt: BrowserPagePrompt, onRespond = vi.fn()) {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.createElement('div'))
  mountedRoots.push(root)
  const render = (next: BrowserPagePrompt) =>
    act(() => {
      root.render(<BrowserPagePromptModal prompt={next} open onRespond={onRespond} />)
    })
  render(prompt)
  return { onRespond, render }
}

/** A prompt kind a newer shell could send that this renderer has no modal for. */
function promptFromNewerShell(requestId: string): BrowserPagePrompt {
  // double-cast-allowed: models a future protocol kind this renderer's types cannot name
  return { requestId, kind: 'future-kind' } as unknown as BrowserPagePrompt
}

afterEach(() => {
  for (const root of mountedRoots.splice(0)) act(() => root.unmount())
})

describe('BrowserPagePromptModal', () => {
  it('refuses a prompt kind it cannot show at once, once per request', () => {
    const { onRespond, render } = renderPrompt(promptFromNewerShell('r1'))
    render(promptFromNewerShell('r1'))
    expect(onRespond).toHaveBeenCalledExactlyOnceWith('r1', { allowed: false })

    render(promptFromNewerShell('r2'))
    expect(onRespond).toHaveBeenCalledTimes(2)
    expect(onRespond).toHaveBeenLastCalledWith('r2', { allowed: false })
  })

  it('leaves a prompt it can show for the user to answer', () => {
    const { onRespond } = renderPrompt({
      requestId: 'r1',
      kind: 'http-auth',
      origin: 'https://intranet.example',
      proxy: false,
      insecure: false,
      retry: false,
    })
    expect(onRespond).not.toHaveBeenCalled()
  })
})
