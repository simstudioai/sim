/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { sleep } from '@sim/utils/helpers'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Code } from './code'

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

describe('Code.Viewer workflow references', () => {
  it('renders dollar replacement sequences literally', async () => {
    await act(async () => {
      root?.render(
        <Code.Viewer
          code={'const secret = {{SECRET_$&_$$}}\nconst output = <block.$$>'}
          language='javascript'
          highlightWorkflowReferences
        />
      )
      await sleep(1)
    })

    expect(
      Array.from(host?.querySelectorAll('[data-code-reference]') ?? [], (node) => node.textContent)
    ).toEqual(['{{SECRET_$&_$$}}', '<block.$$>'])
  })

  it('preserves reference accents when gutter search highlighting is active', async () => {
    await act(async () => {
      root?.render(
        <Code.Viewer
          code='const result = <block.output>'
          language='javascript'
          showGutter
          searchQuery='result'
          highlightWorkflowReferences
        />
      )
      await sleep(1)
    })

    expect(host?.querySelector('[data-code-reference]')?.textContent).toBe('<block.output>')
    expect(host?.querySelector('[data-search-match]')?.textContent).toBe('result')
  })
})
