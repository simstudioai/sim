/** @vitest-environment jsdom */
import { act, createElement, createRef } from 'react'
import type { ChainedCommands } from '@tiptap/core'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import {
  applyLink,
  LinkUrlInput,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/link-editing'

function chainSpy() {
  const calls: string[] = []
  const chain = {
    extendMarkRange: vi.fn(() => chain),
    setLink: vi.fn(({ href }: { href: string }) => {
      calls.push(`setLink:${href}`)
      return chain
    }),
    unsetLink: vi.fn(() => {
      calls.push('unsetLink')
      return chain
    }),
    run: vi.fn(() => true),
  }
  return { chain: chain as unknown as ChainedCommands, calls }
}

describe('applyLink', () => {
  it('sets a link for a target that survives normalization', () => {
    const { chain, calls } = chainSpy()
    applyLink(chain, '  sim.ai  ')
    expect(calls).toEqual(['setLink:https://sim.ai'])
  })

  it('removes the link when the field is cleared', () => {
    const { chain, calls } = chainSpy()
    applyLink(chain, '   ')
    expect(calls).toEqual(['unsetLink'])
  })

  /**
   * The field is seeded with the raw href, so committing one untouched must not be read as "remove".
   * Dropping an unsafe target is a refusal to link, not an instruction to delete what is already there.
   */
  it('leaves the existing link untouched when the target normalizes away', () => {
    for (const target of ['javascript://%0aalert(1)', 'customproto://host/path']) {
      const { chain, calls } = chainSpy()
      applyLink(chain, target)
      expect(calls).toEqual([])
    }
  })
})

describe('LinkUrlInput composition handling', () => {
  it.each(['Enter', 'Escape'])('does not act on %s used by an IME', (key) => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const inputRef = createRef<HTMLInputElement>()
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    act(() =>
      root.render(
        createElement(LinkUrlInput, {
          value: 'https://example.com',
          onChange: vi.fn(),
          onCommit,
          onCancel,
          inputRef,
        })
      )
    )
    try {
      for (const options of [{ isComposing: true }, { isComposing: false, keyCode: 229 }]) {
        const event = new KeyboardEvent('keydown', {
          key,
          bubbles: true,
          cancelable: true,
          ...options,
        })
        act(() => inputRef.current?.dispatchEvent(event))
        expect(event.defaultPrevented).toBe(false)
      }
      expect(onCommit).not.toHaveBeenCalled()
      expect(onCancel).not.toHaveBeenCalled()

      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      act(() => inputRef.current?.dispatchEvent(event))
      expect(event.defaultPrevented).toBe(true)
      expect(key === 'Enter' ? onCommit : onCancel).toHaveBeenCalledOnce()
    } finally {
      act(() => root.unmount())
      host.remove()
    }
  })
})
