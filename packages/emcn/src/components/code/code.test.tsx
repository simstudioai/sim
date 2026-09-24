/**
 * @vitest-environment jsdom
 */
import { act } from 'react'
import { sleep } from '@sim/utils/helpers'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Code } from './code'

let root: Root | null = null
let host: HTMLDivElement | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  vi.unstubAllGlobals()
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

describe('Code.Viewer appearances', () => {
  for (const virtualized of [false, true]) {
    it(`applies the inspection surface to ${virtualized ? 'virtualized' : 'standard'} output`, async () => {
      await act(async () => {
        root?.render(
          <Code.Viewer
            code='{"result": true}'
            language='json'
            showGutter
            virtualized={virtualized}
            appearance='inspection'
            className='max-h-[300px]'
          />
        )
        await sleep(1)
      })

      const viewer = host?.firstElementChild
      expect(viewer?.classList.contains('rounded-md')).toBe(true)
      expect(viewer?.classList.contains('border-0')).toBe(true)
      expect(viewer?.classList.contains('bg-[var(--surface-4)]!')).toBe(true)
      expect(viewer?.classList.contains('dark:bg-[var(--surface-3)]!')).toBe(true)
      expect(viewer?.classList.contains('max-h-[300px]')).toBe(true)
    })
  }

  it('keeps the flat viewer separate from the default code container', async () => {
    await act(async () => {
      root?.render(
        <>
          <Code.Viewer code='default' />
          <Code.Viewer code='flat' appearance='flat' />
        </>
      )
      await sleep(1)
    })

    const [defaultViewer, flatViewer] = Array.from(host?.children ?? [])
    expect(defaultViewer.classList.contains('rounded-sm')).toBe(true)
    expect(flatViewer.classList.contains('rounded-none')).toBe(true)
    expect(flatViewer.classList.contains('bg-[var(--bg)]')).toBe(true)
    expect(flatViewer.classList.contains('dark:bg-[var(--bg)]')).toBe(true)
    expect(flatViewer.textContent).toContain('flat')
  })
})
