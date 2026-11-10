/**
 * @vitest-environment jsdom
 *
 * The on-canvas block picker offers the blocks the viewer may add, judged by their permission
 * group as the server reports it. Failure modes: the picker offering nothing because its list
 * waits on something the page never does (the deleted sidebar used to fill it), and a block the
 * viewer's group withholds still offered.
 */
import { act } from 'react'
import { flushMacrotask } from '@sim/testing/helpers/async'
import { jsonResponse } from '@sim/testing/helpers/http'
import { stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { nextNavigationMock, nextNavigationMockFns } from '@sim/testing/mocks/next-navigation.mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactFlowProvider } from '@xyflow/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => nextNavigationMock)
vi.mock('next/font/local', () => ({ default: () => ({ className: '', style: {} }) }))
vi.unmock('@/blocks/registry')
vi.mock('@/blocks/registry-maps', async () => {
  const { partialBlockRegistry } = await import('@sim/testing/mocks/block-registry.mock')
  const coreBlock = (type: string, name: string) => ({
    type,
    name,
    description: name,
    category: 'blocks',
    bgColor: '#000000',
    icon: () => null,
    subBlocks: [],
    tools: { access: [] },
    inputs: {},
    outputs: {},
  })
  return partialBlockRegistry({
    AgentBlock: coreBlock('agent', 'Agent'),
    FunctionBlock: coreBlock('function', 'Function'),
  })
})

import { ConnectionBlockSelector } from '@/app/(product)/_components/workspace/workflows/canvas/connection-block-selector/connection-block-selector'
import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/platform/lib/data/permission-policy'
import { WorkflowScopeProvider } from '@/platform/lib/data/workflows'

const WORKSPACE_ID = 'workspace-1'

let container: HTMLDivElement
let root: Root

/** Answers the two reads the viewer's block access comes from, with `allowedIntegrations` as their group's allowlist. */
function serveAccess(allowedIntegrations: string[] | null) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'https://sim.test').pathname
    if (path === '/api/settings/allowed-integrations') {
      return jsonResponse({
        allowedIntegrations: null,
        integrationAvailability: [],
        oauthServiceAvailability: [],
      })
    }
    if (path === '/api/permission-groups/user') {
      return jsonResponse({
        permissionGroupId: allowedIntegrations ? 'group-1' : null,
        groupName: allowedIntegrations ? 'Restricted' : null,
        config: allowedIntegrations
          ? { ...DEFAULT_PERMISSION_GROUP_CONFIG, allowedIntegrations }
          : null,
        entitled: true,
        organizationId: 'org-1',
        isOrgAdmin: false,
      })
    }
    return jsonResponse({ error: `unexpected ${path}` }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
}

async function renderPicker() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <WorkflowScopeProvider workspaceId={WORKSPACE_ID} workflowId='workflow-1'>
          <ReactFlowProvider>
            <ConnectionBlockSelector
              {...({
                id: 'picker',
                data: {
                  pendingConnect: {
                    source: { nodeId: 'block-1', handleId: 'source' },
                    position: { x: 0, y: 0 },
                  },
                  onClose: () => undefined,
                },
              } as Parameters<typeof ConnectionBlockSelector>[0])}
            />
          </ReactFlowProvider>
        </WorkflowScopeProvider>
      </QueryClientProvider>
    )
  })
  await act(() => vi.waitFor(() => expect(queryClient.isFetching()).toBe(0)))
  /* React Query hands settled results to its observers on the next macrotask. */
  await act(flushMacrotask)
}

function offeredBlocks() {
  return [...container.querySelectorAll('[cmdk-item]')].map((item) => item.textContent?.trim())
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: false,
    media,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
  Element.prototype.scrollIntoView = () => undefined
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  nextNavigationMockFns.mockUseParams.mockReturnValue({ workspaceId: WORKSPACE_ID })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

it('offers the registry’s blocks to a viewer no permission group restricts', async () => {
  serveAccess(null)
  await renderPicker()
  expect(offeredBlocks()).toEqual(expect.arrayContaining(['Agent', 'Function']))
})

it('withholds a block the viewer’s permission group does not allow', async () => {
  serveAccess(['agent'])
  await renderPicker()
  const offered = offeredBlocks()
  expect(offered).toContain('Agent')
  expect(offered).not.toContain('Function')
})
