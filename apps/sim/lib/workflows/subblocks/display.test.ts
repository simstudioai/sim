/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/blocks', () => ({
  getBlock: (type: string) => (type === 'slack' ? { name: 'Slack' } : undefined),
}))

import {
  getDisplayValue,
  resolveDropdownLabel,
  resolveFilterFieldLabel,
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

  it('falls back to the raw type id for unregistered block-backed tools', () => {
    expect(
      resolveToolsLabel(toolInput, [{ type: 'not_a_real_block', title: 'Sneaky Title' }], [])
    ).toBe('not_a_real_block')
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
})
