import { describe, expect, it, vi } from 'vitest'

vi.mock('@/blocks', () => ({
  getBlock: (type: string) => {
    if (type === 'slack') return { name: 'Slack' }
    if (type === 'workflow' || type === 'workflow_input') return { name: 'Workflow' }
    return undefined
  },
}))

import {
  resolveDropdownLabel,
  resolveFallbackModelsLabel,
  resolveFolderPathLabel,
  resolveSandboxLabel,
  resolveToolsLabel,
  resolveWorkflowSelectionLabel,
} from '@/lib/workflows/subblocks/display'
import type { SubBlockConfig } from '@/blocks/types'

const workflowSelector = { id: 'workflowId', type: 'workflow-selector' } as SubBlockConfig
const toolInput = { id: 'tools', type: 'tool-input' } as SubBlockConfig
const sandboxPicker = { id: 'sandboxId', type: 'combobox' } as SubBlockConfig

describe('workflow selection labels', () => {
  const lookup = { workflowMap: { 'wf-1': { name: 'Billing' } }, ready: true }

  it('labels missing workflows as deleted only after the lookup is ready', () => {
    expect(resolveWorkflowSelectionLabel(workflowSelector, 'wf-gone', lookup)).toBe(
      'Deleted Workflow'
    )
    expect(
      resolveWorkflowSelectionLabel(workflowSelector, 'wf-gone', { ...lookup, ready: false })
    ).toBeNull()
  })
})

describe('resolveToolsLabel', () => {
  it('ignores the stored title on registry-backed tools so state edits cannot rename them', () => {
    const slackName = resolveToolsLabel(toolInput, [{ type: 'slack' }], [])
    expect(slackName).not.toBe(null)
    expect(resolveToolsLabel(toolInput, [{ type: 'slack', title: 'Renamed By Copilot' }], [])).toBe(
      slackName
    )
  })

  it('prefers the live MCP tool name over the stored title', () => {
    expect(
      resolveToolsLabel(
        toolInput,
        [{ type: 'mcp', toolId: 'mcp-1', title: 'Renamed By Copilot' }],
        [],
        new Map([['mcp-1', 'Live MCP Name']])
      )
    ).toBe('Live MCP Name')
    expect(
      resolveToolsLabel(toolInput, [{ type: 'mcp', toolId: 'mcp-1', title: 'Snapshot' }], [])
    ).toBe('Snapshot')
  })
})

describe('resolveFallbackModelsLabel', () => {
  const fallbackList = { id: 'fallbackModels', type: 'model-fallback-list' } as SubBlockConfig

  it('lists the models in order and never the row keys', () => {
    expect(
      resolveFallbackModelsLabel(fallbackList, [
        { id: 'a', model: 'gpt-5' },
        { id: 'b', model: 'openrouter/x', apiKey: '{{OPENROUTER_API_KEY}}' },
        { id: 'c', model: 'gemini-3.6-flash' },
      ])
    ).toBe('gpt-5, openrouter/x +1')
  })
})

describe('resolveSandboxLabel', () => {
  const sandboxes = [{ id: '443f4934-26ab-44ab-8000-000000000000', name: 'Test' }]

  it('resolves the stored id to the name so the card never shows a uuid', () => {
    expect(resolveSandboxLabel(sandboxPicker, sandboxes[0].id, sandboxes)).toBe('Test')
  })
})

describe('resolveDropdownLabel', () => {
  it('summarizes a multi-select selection as labels, not stored ids', () => {
    /* A `multiSelect` dropdown stores an array; rejecting it outright made the
       card show raw ids ("chat, updates") where a single-select showed a label. */
    const dropdown = {
      id: 'labelIds',
      type: 'dropdown',
      multiSelect: true,
      options: [
        { id: 'chat', label: 'Chat' },
        { id: 'updates', label: 'Updates' },
        { id: 'social', label: 'Social' },
      ],
    } as unknown as SubBlockConfig

    expect(resolveDropdownLabel(dropdown, ['chat'])).toBe('Chat')
    expect(resolveDropdownLabel(dropdown, ['chat', 'updates'])).toBe('Chat, Updates')
    expect(resolveDropdownLabel(dropdown, ['chat', 'updates', 'social'])).toBe('Chat, Updates +1')
  })

  it('falls through when any selection is unknown, rather than dropping it', () => {
    /* Showing only the ids it recognised would hide the rest of the selection. */
    const dropdown = {
      id: 'labelIds',
      type: 'dropdown',
      options: [{ id: 'chat', label: 'Chat' }],
    } as unknown as SubBlockConfig

    expect(resolveDropdownLabel(dropdown, ['chat', 'gone'])).toBeNull()
    expect(resolveDropdownLabel(dropdown, [])).toBeNull()
  })
})

/**
 * A type listed in SELECTOR_TYPES_HYDRATION_REQUIRED with no resolver renders
 * as the unset placeholder, so a folder picked in the editor showed as "-" on
 * the canvas, indistinguishable from having picked nothing.
 */
describe('resolveFolderPathLabel', () => {
  const folderSubBlock = {
    id: 'createParentPath',
    type: 'folder-selector',
    resourceType: 'file',
  } as any

  it('decodes an encoded name rather than showing the escape', () => {
    expect(resolveFolderPathLabel(folderSubBlock, '/Reports/Q3%20Results')).toBe(
      'Reports / Q3 Results'
    )
  })
})
