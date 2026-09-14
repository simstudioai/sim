/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { applySuppliedToolModes } from '@/lib/workflows/editing/tool-modes'
import type { CanonicalIndex } from '@/lib/workflows/subblocks/visibility'

const JIRA_INDEX: CanonicalIndex = {
  groupsById: {
    projectId: { canonicalId: 'projectId', basicId: 'projectId', advancedIds: ['manualProjectId'] },
  },
  canonicalIdBySubBlockId: { projectId: 'projectId', manualProjectId: 'projectId' },
}

const getCanonicalIndex = (toolType: string) => (toolType === 'jira' ? JIRA_INDEX : null)

function apply(
  tools: unknown[],
  originalTools: unknown[] | undefined,
  canonicalModes: Record<string, 'basic' | 'advanced'> = {}
) {
  return applySuppliedToolModes({
    tools,
    originalTools,
    canonicalModes,
    getCanonicalIndex,
    includePermissionMode: true,
  })
}

describe('applySuppliedToolModes', () => {
  const jiraBoth = {
    type: 'jira',
    operation: 'read-bulk',
    params: { domain: 'example.atlassian.net', projectId: 'SEL', manualProjectId: 'MAN-OLD' },
    usageControl: 'none',
    usageControlExpression: '<start.toolMode>',
  }

  it('switches a nested pair to the side supplied and keeps the side left out', () => {
    const manualOnly = {
      type: 'jira',
      operation: 'read-bulk',
      params: { domain: 'example.atlassian.net', manualProjectId: 'MAN-NEW' },
      usageControl: 'none',
      usageControlExpression: '<start.toolMode>',
    }

    const result = apply([manualOnly], [jiraBoth])

    expect(result.canonicalModes).toEqual({ '0:projectId': 'advanced' })
    expect(result.tools[0]).toMatchObject({
      params: { domain: 'example.atlassian.net', projectId: 'SEL', manualProjectId: 'MAN-NEW' },
    })

    const selectorOnly = { ...manualOnly, params: { projectId: 'SEL-NEW' } }
    const back = apply([selectorOnly], [result.tools[0]], result.canonicalModes)

    expect(back.canonicalModes).toEqual({ '0:projectId': 'basic' })
    expect(back.tools[0]).toMatchObject({
      params: { projectId: 'SEL-NEW', manualProjectId: 'MAN-NEW' },
    })
  })

  it('switches Permission Mode to the value supplied and keeps the value left out', () => {
    const expressionOnly = { type: 'wikipedia', usageControlExpression: '<start.toolMode>' }
    const fixed = { type: 'wikipedia', usageControl: 'none' }

    const variable = apply([expressionOnly], [fixed])
    expect(variable.canonicalModes).toEqual({ '0:agentToolUsageControl': 'advanced' })
    expect(variable.tools[0]).toEqual({
      type: 'wikipedia',
      usageControl: 'none',
      usageControlExpression: '<start.toolMode>',
    })

    const selector = apply(
      [{ type: 'wikipedia', usageControl: 'force' }],
      variable.tools,
      variable.canonicalModes
    )
    expect(selector.canonicalModes).toEqual({})
    expect(selector.tools[0]).toEqual({
      type: 'wikipedia',
      usageControl: 'force',
      usageControlExpression: '<start.toolMode>',
    })
  })

  it('keeps the current modes when both sides are supplied', () => {
    const modes = { '0:projectId': 'advanced', '0:agentToolUsageControl': 'advanced' } as const
    const edited = { ...jiraBoth, params: { ...jiraBoth.params, manualProjectId: 'MAN-NEW' } }

    const result = apply([edited], [jiraBoth], modes)

    expect(result.canonicalModes).toEqual(modes)
    expect(result.tools[0]).toBe(edited)
  })

  it('returns Permission Mode to the Selector default when neither value is supplied', () => {
    const result = apply([{ type: 'wikipedia' }], [{ type: 'wikipedia', usageControl: 'none' }], {
      '0:agentToolUsageControl': 'advanced',
    })

    expect(result.canonicalModes).toEqual({})
    expect(result.tools[0]).toEqual({ type: 'wikipedia' })
  })

  it('leaves a tool identical to its previous entry untouched', () => {
    const pendingToggle = { type: 'jira', params: { manualProjectId: 'MAN' }, usageControl: 'auto' }
    const modes = { '0:projectId': 'basic', '0:agentToolUsageControl': 'advanced' } as const

    const result = apply([{ ...pendingToggle, isExpanded: true }], [pendingToggle], modes)

    expect(result.canonicalModes).toEqual(modes)
  })

  it('keeps the mode of a pair an edit resends unchanged', () => {
    const stored = { type: 'jira', params: { manualProjectId: 'MAN' }, usageControl: 'auto' }

    const result = apply([{ ...stored, usageControl: 'none' }], [stored], {
      '0:projectId': 'basic',
    })

    expect(result.canonicalModes).toEqual({ '0:projectId': 'basic' })
  })

  it('selects modes for new tools without carrying values from other tools', () => {
    const result = apply(
      [
        jiraBoth,
        {
          type: 'jira',
          operation: 'write',
          params: { manualProjectId: 'NEW' },
          usageControl: 'auto',
        },
      ],
      [jiraBoth]
    )

    expect(result.canonicalModes).toEqual({ '1:projectId': 'advanced' })
    expect(result.tools[1]).toMatchObject({ params: { manualProjectId: 'NEW' } })
    expect(result.tools[1]).not.toHaveProperty('params.projectId')
  })
})
