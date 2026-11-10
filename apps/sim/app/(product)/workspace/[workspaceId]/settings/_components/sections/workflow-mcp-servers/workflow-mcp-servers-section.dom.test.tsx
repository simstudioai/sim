/**
 * @vitest-environment jsdom
 *
 * Deleting a workflow MCP server confirms first, and the confirmation is where the outcome lands.
 * Failure modes: the dialog closing the moment Delete is pressed, so a refusal surfaces nowhere
 * near it, and a failed delete leaving no dialog to try again from.
 */
import { act } from 'react'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { stubDialog, stubResizeObserver } from '@sim/testing/mocks/browser-apis.mock'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mcp = vi.hoisted(() => ({ deleteServer: vi.fn() }))
vi.mock('@/platform/lib/data/workspace-settings', () => ({
  useWorkspaceSettingsSection: () => ({ canMutate: true, permission: 'admin' }),
}))
vi.mock(
  '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/workflow-mcp-servers/server-detail',
  () => ({
    ServerDetail: ({ onDelete }: { onDelete: () => void }) => (
      <button type='button' onClick={onDelete}>
        Delete server
      </button>
    ),
  })
)
vi.mock('@/platform/lib/data/mcp', () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn() }),
  useDeleteWorkflowMcpServer: () => ({ mutateAsync: mcp.deleteServer }),
  useDeployedWorkflows: () => ({ data: [] }),
  useMcpServerIdParam: () => ['srv', vi.fn()],
  useMcpServerTabParam: () => [null, vi.fn()],
  useSettingsSearch: () => ['', vi.fn()],
  useWorkflowMcpServers: () => ({
    isPending: false,
    data: [{ id: 'srv', name: 'Deploys', toolCount: 1, isPublic: false }],
  }),
}))

import WorkflowMcpServersSection from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/workflow-mcp-servers/workflow-mcp-servers-section'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  stubResizeObserver()
  stubDialog()
  mcp.deleteServer.mockReset()
  container = document.createElement('div')
  container.setAttribute('data-emcn', '')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const openDialog = () => document.querySelector('dialog[open]')

async function requestDelete() {
  act(() => root.render(<WorkflowMcpServersSection workspaceId='ws' subpath={[]} />))
  const open = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Delete server'
  )
  await act(async () => open?.click())
  const confirm = [...document.querySelectorAll<HTMLButtonElement>('dialog[open] button')].find(
    (button) => button.textContent === 'Delete'
  )
  await act(async () => confirm?.click())
}

it('keeps the confirmation open until the delete settles, then closes it', async () => {
  const deletion = createDeferred<void>()
  mcp.deleteServer.mockReturnValue(deletion.promise)
  await requestDelete()
  expect(openDialog()).not.toBeNull()
  await act(async () => deletion.resolve())
  expect(openDialog()).toBeNull()
})

it('keeps the confirmation open with the reason when the delete fails', async () => {
  mcp.deleteServer.mockRejectedValue(new Error('Server is in use'))
  await requestDelete()
  expect(openDialog()?.textContent).toContain('Server is in use')
})
