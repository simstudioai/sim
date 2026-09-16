/** @vitest-environment jsdom */
import { act } from 'react'
import { QueryClient } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveNamedCliToolDisplayTitle } from '@/lib/mothership/tools/client/resource-display'
import { cliFirstPositional, getToolDisplayTitle } from '@/lib/mothership/tools/tool-display'
import { useToolResourceTitles } from '@/app/workspace/[workspaceId]/home/hooks/use-tool-resource-titles'
import type { ContentBlock } from '@/app/workspace/[workspaceId]/home/types'

vi.mock('@/lib/auth/auth-client', () => ({ useSession: vi.fn() }))
vi.mock('next/navigation', () => ({ useParams: () => ({ workspaceId: 'chat-workspace' }) }))
vi.mock('@/app/_shell/providers/get-query-client', () => ({ getQueryClient: () => client }))
vi.mock('@/blocks/registry', () => ({
  getBlock: (id: string) => (id === 'google_sheets' ? { name: 'Google Sheets' } : undefined),
}))

const client = new QueryClient()
const id = '35d56b14-0b30-4352-9d48-93d90fded299'
const context = { workspaceId: 'chat-workspace' }

beforeEach(() => client.clear())

describe('named CLI resource rows', () => {
  it.each([
    {
      command: ['workflows', 'get'],
      key: ['workflows', 'list', 'chat-workspace', 'active'],
      title: 'Invoice API',
      expected: 'Reading Invoice API',
    },
    {
      command: ['workflows', 'deploy'],
      key: ['workflows', 'list', 'chat-workspace', 'active'],
      title: 'Invoice API',
      expected: 'Deploying Invoice API',
    },
    {
      command: ['tables', 'rows', 'list'],
      key: ['tables', 'list', 'chat-workspace', 'active'],
      title: 'Customers',
      expected: 'Listing Customers rows',
    },
    {
      command: ['files', 'read'],
      key: ['workspaceFiles', 'list', 'chat-workspace', 'active'],
      title: 'Revenue.csv',
      expected: 'Reading Revenue.csv',
    },
    {
      command: ['knowledge', 'search'],
      key: ['knowledge', 'list', 'chat-workspace', 'active'],
      title: 'Product Docs',
      expected: 'Searching Product Docs',
    },
    {
      command: ['skills', 'get'],
      key: ['skills', 'list', 'chat-workspace'],
      title: 'Research',
      expected: 'Reading Research',
    },
    {
      command: ['custom-tools', 'get'],
      key: ['customTools', 'list', 'chat-workspace'],
      title: 'CRM Lookup',
      expected: 'Reading CRM Lookup',
    },
    {
      command: ['mcp-servers', 'get'],
      key: ['mcp', 'servers', 'chat-workspace'],
      title: 'Company Search',
      expected: 'Reading Company Search',
    },
    {
      command: ['workspaces', 'get'],
      key: ['workspace', 'list', 'user', 'active'],
      title: 'Sales',
      expected: 'Reading Sales',
    },
    {
      command: ['workflows', 'folders', 'delete'],
      key: ['folders', 'list', 'workflow', 'chat-workspace', 'active'],
      title: 'Drafts',
      expected: 'Deleting Drafts',
    },
    {
      command: ['files', 'folders', 'delete'],
      key: ['workspaceFileFolders', 'list', 'chat-workspace', 'active'],
      title: 'Reports',
      expected: 'Deleting Reports',
    },
  ])('names $expected without opening its editor', ({ command, key, title, expected }) => {
    client.setQueryData(key, [{ id, name: title }])
    const name = `cli_${command.join('_').replace(/-/g, '_')}`
    const args = { args: [...command, id] }
    expect(cliFirstPositional(name, args)).toBe(id)
    expect(resolveNamedCliToolDisplayTitle(name, args, context)).toBe(expected)
  })

  it('does not use another workspace or replace a target with a created/renamed name flag', () => {
    client.setQueryData(
      ['workflows', 'list', 'editor-workspace', 'active'],
      [{ id, name: 'Wrong workflow' }]
    )
    const args = { args: ['workflows', 'update', id, '--name', 'New name'] }
    expect(resolveNamedCliToolDisplayTitle('cli_workflows_update', args, context)).toBeUndefined()
    expect(getToolDisplayTitle('cli_workflows_update', args)).toBe('Updating workflow')
    expect(getToolDisplayTitle('cli_files_view', { args: ['files', 'view', id] })).toBe(
      'Viewing file'
    )
  })

  it.each([
    ['cli_logs_list', ['logs', 'list'], 'Listing run logs in Sales'],
    ['cli_files_list', ['files', 'list'], 'Listing files in Sales'],
    ['cli_workspaces_get', ['workspaces', 'get', 'sales'], 'Reading Sales'],
    ['cli_workflows_list', ['workflows', 'list'], 'Listing workflows in Sales'],
    ['cli_workflows_get', ['workflows', 'get', id], 'Reading Invoice API in Sales'],
    ['cli_files_get', ['files', 'get', id], 'Reading Revenue.csv in Sales'],
  ])('names the invocation workspace for %s without a chat workspace', (name, argv, expected) => {
    client.setQueryData(['workspace', 'list', 'user', 'active'], {
      workspaces: [{ id: 'sales', name: 'Sales' }],
    })
    client.setQueryData(['workflows', 'list', 'sales', 'active'], [{ id, name: 'Invoice API' }])
    client.setQueryData(
      ['workspaceFiles', 'list', 'sales', 'active'],
      [{ id, name: 'Revenue.csv' }]
    )
    const args = { request: { workspaceId: 'sales', invocation: { kind: 'cli', argv } } }
    expect(resolveNamedCliToolDisplayTitle(name, args, {})).toBe(expected)
    expect(client.isFetching()).toBe(0)
  })

  it('uses raw workspace selectors while arguments stream and keeps all workflow filters', () => {
    client.setQueryData(
      ['workspace', 'adminList', 'viewer', 'org'],
      [{ id: 'sales', name: 'Sales' }]
    )
    client.setQueryData(
      ['workflows', 'list', 'sales', 'active'],
      [
        { id, name: 'Invoice API' },
        { id: 'second', name: 'Payments API' },
      ]
    )
    const args = { args: ['--workspace=sales', 'logs', 'list', '--workflow', id, 'second'] }
    expect(resolveNamedCliToolDisplayTitle('cli_logs_list', args, {})).toBe(
      'Listing run logs for Invoice API, Payments API in Sales'
    )
    expect(
      resolveNamedCliToolDisplayTitle(
        'cli_workflows_get',
        {
          args: ['-wsales', 'workflows', 'get', id],
        },
        {}
      )
    ).toBe('Reading Invoice API in Sales')
    expect(
      resolveNamedCliToolDisplayTitle(
        'cli_logs_list',
        {
          args: ['logs', 'list', '--workspace', 'sales', '--workflow', id, 'unknown'],
        },
        {}
      )
    ).toBe('Listing run logs in Sales')
  })

  it('uses confirmed owner and run names without mixing another workspace inventory', () => {
    client.setQueryData(['workflows', 'list', 'chat-workspace', 'active'], [{ id, name: 'Wrong' }])
    expect(
      resolveNamedCliToolDisplayTitle(
        'cli_workflows_get',
        { args: ['workflows', 'get', id] },
        {
          ...context,
          resources: [
            {
              type: 'workflow',
              id,
              title: 'Invoice API',
              workspaceId: 'sales',
              workspaceName: 'Sales',
            },
          ],
        }
      )
    ).toBe('Reading Invoice API in Sales')
    expect(
      resolveNamedCliToolDisplayTitle(
        'cli_logs_get',
        { args: ['logs', 'get', 'run'] },
        {
          resources: [
            {
              type: 'log',
              id: 'run',
              title: 'Invoice API',
              workspaceId: 'sales',
              workspaceName: 'Sales',
            },
          ],
        }
      )
    ).toBe('Reading run log for Invoice API in Sales')
    expect(
      resolveNamedCliToolDisplayTitle(
        'cli_workflows_get',
        {
          request: {
            workspaceId: 'other',
            invocation: { kind: 'cli', argv: ['workflows', 'get', id] },
          },
        },
        { resources: [{ type: 'workflow', id, title: 'Wrong', workspaceId: 'sales' }] }
      )
    ).toBeUndefined()
  })

  it('names path-addressed file reads during replay without fetching an inventory', () => {
    expect(
      resolveNamedCliToolDisplayTitle(
        'cli_files_read',
        { args: ['--output', 'json', 'files', 'read', 'files/panel-notes.md'] },
        context
      )
    ).toBe('Reading panel-notes.md')
    expect(client.isFetching()).toBe(0)
  })

  it('uses confirmed resources before inventory hydration and retains literal replacement characters', () => {
    const title = 'Invoices $& forecast'
    expect(
      resolveNamedCliToolDisplayTitle(
        'cli_workflows_get',
        { args: ['workflows', 'get', id] },
        {
          ...context,
          resources: [{ type: 'workflow', id, title }],
        }
      )
    ).toBe(`Reading ${title}`)
    expect(
      resolveNamedCliToolDisplayTitle(
        'cli_blocks_get',
        { args: ['blocks', 'get', 'google_sheets'] },
        context
      )
    ).toBe('Reading Google Sheets configuration')
  })

  it('refreshes cross-workspace list labels when the organization inventory arrives', () => {
    const blocks: ContentBlock[] = [
      {
        type: 'tool_call',
        toolCall: {
          id: 'logs',
          name: 'cli_logs_list',
          status: 'success',
          displayTitle: 'Listing run logs',
          params: {
            request: { workspaceId: 'sales', invocation: { kind: 'cli', argv: ['logs', 'list'] } },
          },
        },
      },
    ]
    function Probe() {
      const titled = useToolResourceTitles(blocks)
      return <span>{titled[0].toolCall?.displayTitle}</span>
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    act(() => root.render(<Probe />))
    expect(container.textContent).toBe('Listing run logs')
    act(() => {
      client.setQueryData(
        ['workspace', 'adminList', 'viewer', 'org'],
        [{ id: 'sales', name: 'Sales' }]
      )
    })
    expect(container.textContent).toBe('Listing run logs in Sales')
    expect(client.isFetching()).toBe(0)
    act(() => root.unmount())
  })

  it('refreshes persisted generic rows as inventory arrives and names change, with no fetch', () => {
    const blocks: ContentBlock[] = [
      {
        type: 'tool_call',
        toolCall: {
          id: 'tool',
          name: 'cli_workflows_get',
          status: 'success',
          displayTitle: 'Reading workflow',
          params: { args: ['workflows', 'get', id] },
        },
      },
    ]
    function Probe() {
      const titled = useToolResourceTitles(blocks)
      return <span>{titled[0].toolCall?.displayTitle}</span>
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    act(() => root.render(<Probe />))
    expect(container.textContent).toBe('Reading workflow')
    act(() => {
      client.setQueryData(
        ['workflows', 'list', 'chat-workspace', 'active'],
        [{ id, name: 'Invoice API' }]
      )
    })
    expect(container.textContent).toBe('Reading Invoice API')
    act(() => {
      client.setQueryData(
        ['workflows', 'list', 'chat-workspace', 'active'],
        [{ id, name: 'Payments API' }]
      )
    })
    expect(container.textContent).toBe('Reading Payments API')
    expect(client.isFetching()).toBe(0)
    act(() => root.unmount())
  })
})
