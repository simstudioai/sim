/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/blocks', () => ({
  getBlock: (type: string) => {
    if (type === 'slack') return { name: 'Slack' }
    if (type === 'workflow' || type === 'workflow_input') return { name: 'Workflow' }
    return undefined
  },
}))

import {
  getDisplayValue,
  resolveDropdownLabel,
  resolveFilterFieldLabel,
  resolveFolderPathLabel,
  resolveSandboxLabel,
  resolveSkillsLabel,
  resolveToolsLabel,
  resolveVariablesLabel,
  resolveWorkflowMultiSelectLabel,
  resolveWorkflowSelectionLabel,
  summarizeNames,
} from '@/lib/workflows/subblocks/display'
import type { SubBlockConfig } from '@/blocks/types'

const workflowSelector = { id: 'workflowId', type: 'workflow-selector' } as SubBlockConfig
const workflowMulti = {
  id: 'workflowIds',
  type: 'dropdown',
  multiSelect: true,
} as SubBlockConfig
const variablesInput = { id: 'variables', type: 'variables-input' } as SubBlockConfig
const toolInput = { id: 'tools', type: 'tool-input' } as SubBlockConfig
const skillInput = { id: 'skills', type: 'skill-input' } as SubBlockConfig
const sandboxPicker = { id: 'sandboxId', type: 'combobox' } as SubBlockConfig

describe('summarizeNames', () => {
  it('formats 0, 1, 2, and 2+N name lists', () => {
    expect(summarizeNames([])).toBeNull()
    expect(summarizeNames(['A'])).toBe('A')
    expect(summarizeNames(['A', 'B'])).toBe('A, B')
    expect(summarizeNames(['A', 'B', 'C', 'D'])).toBe('A, B +2')
  })
})

describe('workflow selection labels', () => {
  const lookup = { workflowMap: { 'wf-1': { name: 'Billing' } }, ready: true }

  it('resolves a single workflow selection to its name', () => {
    expect(resolveWorkflowSelectionLabel(workflowSelector, 'wf-1', lookup)).toBe('Billing')
  })

  it('labels missing workflows as deleted only after the lookup is ready', () => {
    expect(resolveWorkflowSelectionLabel(workflowSelector, 'wf-gone', lookup)).toBe(
      'Deleted Workflow'
    )
    expect(
      resolveWorkflowSelectionLabel(workflowSelector, 'wf-gone', { ...lookup, ready: false })
    ).toBeNull()
  })

  it('summarizes multi-select workflow ids with the deleted fallback', () => {
    expect(resolveWorkflowMultiSelectLabel(workflowMulti, ['wf-1', 'wf-gone'], lookup)).toBe(
      'Billing, Deleted Workflow'
    )
    expect(
      resolveWorkflowMultiSelectLabel(workflowMulti, ['wf-1'], { ...lookup, ready: false })
    ).toBeNull()
  })

  it('matches multi-select subblocks by canonicalParamId as well as id', () => {
    const canonical = {
      id: 'workflowSelector',
      type: 'dropdown',
      multiSelect: true,
      canonicalParamId: 'workflowIds',
    } as SubBlockConfig
    expect(resolveWorkflowMultiSelectLabel(canonical, ['wf-1'], lookup)).toBe('Billing')
  })
})

describe('resolveVariablesLabel', () => {
  it('resolves variable ids to live names and falls back to stored names', () => {
    const variables = [{ id: 'var-1', name: 'apiKey' }]
    expect(
      resolveVariablesLabel(
        variablesInput,
        [
          { variableId: 'var-1', value: 1 },
          { variableName: 'region', value: 2 },
        ],
        variables
      )
    ).toBe('apiKey, region')
  })
})

describe('resolveToolsLabel', () => {
  it('resolves titles, custom tools by id, schema names, and registry blocks', () => {
    const customTools = [{ id: 'ct-1', title: 'My Tool' }]
    expect(
      resolveToolsLabel(
        toolInput,
        [
          { title: 'Explicit' },
          { type: 'custom-tool', customToolId: 'ct-1' },
          { schema: { function: { name: 'inline_fn' } } },
          { type: 'slack' },
        ],
        customTools
      )
    ).toBe('Explicit, My Tool +2')
  })

  it('skips unresolvable entries instead of inventing labels', () => {
    expect(resolveToolsLabel(toolInput, [{ type: 'custom-tool', customToolId: 'gone' }], [])).toBe(
      null
    )
  })

  it('ignores the stored title on registry-backed tools so state edits cannot rename them', () => {
    const slackName = resolveToolsLabel(toolInput, [{ type: 'slack' }], [])
    expect(slackName).not.toBe(null)
    expect(resolveToolsLabel(toolInput, [{ type: 'slack', title: 'Renamed By Copilot' }], [])).toBe(
      slackName
    )
  })

  it('falls back to the stored title, then the raw type id, for unresolvable block types', () => {
    expect(
      resolveToolsLabel(toolInput, [{ type: 'custom_block_gone', title: 'Invoice Parser' }], [])
    ).toBe('Invoice Parser')
    expect(resolveToolsLabel(toolInput, [{ type: 'custom_block_gone' }], [])).toBe(
      'custom_block_gone'
    )
  })

  it('renders the static label for workflow-as-tool entries regardless of stored title', () => {
    expect(
      resolveToolsLabel(toolInput, [{ type: 'workflow', title: 'Renamed By Copilot' }], [])
    ).toBe('Workflow')
    expect(resolveToolsLabel(toolInput, [{ type: 'workflow_input' }], [])).toBe('Workflow')
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

  it('prefers the custom tool record over the stored title', () => {
    expect(
      resolveToolsLabel(
        toolInput,
        [{ type: 'custom-tool', customToolId: 'ct-1', title: 'Renamed By Copilot' }],
        [{ id: 'ct-1', title: 'My Tool' }]
      )
    ).toBe('My Tool')
  })
})

describe('resolveSkillsLabel', () => {
  it('prefers live skill names and falls back to the stored name', () => {
    const skills = [{ id: 'sk-1', name: 'Research' }]
    expect(
      resolveSkillsLabel(
        skillInput,
        [{ skillId: 'sk-1' }, { skillId: 'sk-deleted', name: 'Old Name' }],
        skills
      )
    ).toBe('Research, Old Name')
  })

  it('never renders raw skill ids', () => {
    expect(resolveSkillsLabel(skillInput, [{ skillId: 'sk-unknown' }], [])).toBeNull()
  })
})

describe('resolveSandboxLabel', () => {
  const sandboxes = [{ id: '443f4934-26ab-44ab-8000-000000000000', name: 'Test' }]

  it('resolves the stored id to the name so the card never shows a uuid', () => {
    expect(resolveSandboxLabel(sandboxPicker, sandboxes[0].id, sandboxes)).toBe('Test')
  })

  it('returns null for an id the workspace no longer has', () => {
    expect(resolveSandboxLabel(sandboxPicker, 'sbx-deleted', sandboxes)).toBeNull()
  })

  it('returns null before the list loads, and for an empty selection', () => {
    expect(resolveSandboxLabel(sandboxPicker, sandboxes[0].id, [])).toBeNull()
    expect(resolveSandboxLabel(sandboxPicker, '', sandboxes)).toBeNull()
  })

  it('ignores other comboboxes so it cannot relabel an unrelated field', () => {
    const other = { id: 'model', type: 'combobox' } as SubBlockConfig
    expect(resolveSandboxLabel(other, sandboxes[0].id, sandboxes)).toBeNull()
  })
})

describe('resolveDropdownLabel', () => {
  const dropdown = {
    id: 'mode',
    type: 'dropdown',
    options: [{ id: 'opt-1', label: 'Option One' }, 'literal'],
  } as SubBlockConfig

  it('resolves option ids and string options to labels', () => {
    expect(resolveDropdownLabel(dropdown, 'opt-1')).toBe('Option One')
    expect(resolveDropdownLabel(dropdown, 'literal')).toBe('literal')
    expect(resolveDropdownLabel(dropdown, 'missing')).toBeNull()
  })

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

describe('resolveFilterFieldLabel', () => {
  const filterField = { id: 'filter', type: 'short-input' } as SubBlockConfig

  it('renders compact JSON for filter fields and truncates long values', () => {
    expect(resolveFilterFieldLabel(filterField, '{"a":1}')).toBe('{"a":1}')
    const long = JSON.stringify({ column: 'status', operator: 'contains', value: 'running' })
    expect(resolveFilterFieldLabel(filterField, long)).toBe(`${long.slice(0, 32)}...`)
  })

  it('returns null for non-filter subblocks and non-JSON values', () => {
    expect(
      resolveFilterFieldLabel({ id: 'other', type: 'short-input' } as SubBlockConfig, '{"a":1}')
    ).toBeNull()
    expect(resolveFilterFieldLabel(filterField, 'plain text')).toBeNull()
  })
})

describe('getDisplayValue', () => {
  it('handles empty, scalar, and object values', () => {
    expect(getDisplayValue(null)).toBe('-')
    expect(getDisplayValue('hello')).toBe('hello')
    expect(getDisplayValue({ a: 1 })).toBe('a: 1')
  })

  it('summarizes name-bearing arrays', () => {
    expect(
      getDisplayValue([
        { variableName: 'one', variableId: 'v1', value: 1 },
        { variableName: 'two', variableId: 'v2', value: 2 },
        { variableName: 'three', variableId: 'v3', value: 3 },
      ])
    ).toBe('one, two +1')
    expect(getDisplayValue(['a', 'b'])).toBe('a, b')
  })

  it('keeps the full first message for renderer-owned clipping and tooltips', () => {
    const content = `You are a research assistant. ${'Keep every instruction. '.repeat(4)}`.trim()
    const messages = [{ role: 'system', content }]
    const serializedMessages = JSON.stringify(messages)

    expect(getDisplayValue(messages)).toBe(content)
    expect(getDisplayValue(serializedMessages)).toBe(content)
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

  it('names a folder from its canonical path', () => {
    expect(resolveFolderPathLabel(folderSubBlock, '/Other')).toBe('Other')
  })

  it('reads a nested path as its names', () => {
    expect(resolveFolderPathLabel(folderSubBlock, '/Other/Vik')).toBe('Other / Vik')
  })

  it('decodes an encoded name rather than showing the escape', () => {
    expect(resolveFolderPathLabel(folderSubBlock, '/Reports/Q3%20Results')).toBe(
      'Reports / Q3 Results'
    )
  })

  it('keeps a slash inside a name out of the separator', () => {
    expect(resolveFolderPathLabel(folderSubBlock, '/Q3%2FQ4')).toBe('Q3/Q4')
  })

  it('leaves an unset value to the placeholder', () => {
    expect(resolveFolderPathLabel(folderSubBlock, '')).toBeNull()
    expect(resolveFolderPathLabel(folderSubBlock, null)).toBeNull()
    expect(resolveFolderPathLabel(folderSubBlock, '/')).toBeNull()
  })

  it('reads an array-shaped value the other readers accept', () => {
    expect(resolveFolderPathLabel(folderSubBlock, ['/Other/Vik'])).toBe('Other / Vik')
    expect(resolveFolderPathLabel(folderSubBlock, '["/Other/Vik"]')).toBe('Other / Vik')
  })

  it('summarizes every selected folder', () => {
    expect(resolveFolderPathLabel(folderSubBlock, ['/One', '/Two', '/Three'])).toBe('One, Two +1')
  })

  it('leaves an empty array to the placeholder', () => {
    expect(resolveFolderPathLabel(folderSubBlock, [])).toBeNull()
    expect(resolveFolderPathLabel(folderSubBlock, '[]')).toBeNull()
  })

  it('ignores a subblock of another type', () => {
    expect(resolveFolderPathLabel({ id: 'x', type: 'short-input' } as any, '/Other')).toBeNull()
  })

  it('shows a hand-typed path that will not parse as typed', () => {
    expect(resolveFolderPathLabel(folderSubBlock, 'Other')).toBe('Other')
  })
})
