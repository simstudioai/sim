/**
 * @vitest-environment jsdom
 *
 * Search's "This page" group on Logs. Failure modes: legacy's Export and view switch missing from
 * search, Export offered to a viewer who may not export, and the switch naming the view already
 * showing.
 */
import { act } from 'react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type PageCommand,
  PageCommandsProvider,
  useRegisteredPageCommands,
} from '@/app/(product)/_components/command-menu/page-commands'
import { useRunPageCommands } from '@/app/(product)/workspace/[workspaceId]/logs/_components/live-runs/page-commands'

const mounted: Root[] = []

function renderCommands(canExport: boolean, search = '') {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const root = createRoot(document.createElement('div'))
  mounted.push(root)
  let offered: readonly PageCommand[] = []
  function Page() {
    useRunPageCommands({ exportHref: '/api/logs/export?workspaceId=ws-1', canExport })
    return null
  }
  function Search() {
    offered = useRegisteredPageCommands()
    return null
  }
  act(() =>
    root.render(
      <NuqsTestingAdapter searchParams={search} hasMemory>
        <PageCommandsProvider>
          <Page />
          <Search />
        </PageCommandsProvider>
      </NuqsTestingAdapter>
    )
  )
  return {
    labels: () => offered.map((command) => command.label),
    run: (label: string) => act(() => offered.find((command) => command.label === label)?.run()),
  }
}

describe('useRunPageCommands', () => {
  afterEach(() => {
    for (const root of mounted.splice(0)) act(() => root.unmount())
  })

  it('offers Export and the Dashboard view to a viewer who may export', () => {
    expect(renderCommands(true).labels()).toEqual(['Export', 'Switch to dashboard'])
  })

  it('withholds Export from a viewer who may not export', () => {
    expect(renderCommands(false).labels()).toEqual(['Switch to dashboard'])
  })

  it('switches between the views it names', () => {
    const page = renderCommands(false, '?view=dashboard')
    expect(page.labels()).toEqual(['Switch to runs'])

    page.run('Switch to runs')

    expect(page.labels()).toEqual(['Switch to dashboard'])
  })
})
