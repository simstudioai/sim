/**
 * @vitest-environment jsdom
 *
 * A release's notes are a read. Failure mode: a failed read painting a bare error with no way to
 * try again.
 */
import { act } from 'react'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const notes = vi.hoisted(() => ({ retry: vi.fn() }))
vi.mock('@/platform/lib/data/changelog', () => ({
  useReleaseNotes: () => ({
    missing: false,
    error: new Error('Network down'),
    content: undefined,
    retrying: false,
    retry: notes.retry,
  }),
}))

import { ReleaseNotes } from '@/app/(product)/workspace/[workspaceId]/changelog/_components/release-notes/release-notes'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

it('offers Retry when the notes fail to load', async () => {
  act(() => root.render(<ReleaseNotes workspaceId='ws' fileId='file' />))
  const retry = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Retry')
  await act(async () => retry?.click())
  expect(notes.retry).toHaveBeenCalled()
})
