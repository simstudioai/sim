/** @vitest-environment jsdom */

import type { ChainedCommands } from '@tiptap/core'
import { describe, expect, it, vi } from 'vitest'
import { applyLink } from '@/app/workspace/[workspaceId]/files/components/file-viewer/rich-markdown-editor/menus/link-editing'

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
