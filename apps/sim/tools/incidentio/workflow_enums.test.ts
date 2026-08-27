/**
 * @vitest-environment node
 *
 * `runs_on_incidents` is a closed enum. Verified against
 * https://api.incident.io/v1/openapiV3.json: both `WorkflowsCreateWorkflowPayloadV2` and
 * `WorkflowsUpdateWorkflowPayloadV2` declare
 * `enum: ["newly_created", "newly_created_and_active"]`. The value passes straight through to the
 * API, so any other value the block or a `user-or-llm` description advertises becomes a 422.
 */
import { describe, expect, it } from 'vitest'
import { IncidentioBlock } from '@/blocks/blocks/incidentio'
import { workflowsCreateTool } from '@/tools/incidentio/workflows_create'
import { workflowsUpdateTool } from '@/tools/incidentio/workflows_update'

/** The complete spec enum, verbatim from `WorkflowsCreateWorkflowPayloadV2`. */
const RUNS_ON_INCIDENTS_ENUM = ['newly_created', 'newly_created_and_active'] as const

/** Values the repo used to advertise that the API has never accepted. */
const INVENTED_VALUES = ['active', 'all'] as const

describe('runs_on_incidents offers only the two values the API accepts', () => {
  it('the block dropdown lists exactly the spec enum', () => {
    const subBlock = IncidentioBlock.subBlocks.find((entry) => entry.id === 'runs_on_incidents')
    expect(subBlock).toBeDefined()

    const ids = (subBlock?.options as Array<{ id: string }>).map((option) => option.id)
    expect(ids).toEqual([...RUNS_ON_INCIDENTS_ENUM])
  })

  const toolCases = [
    ['workflows_create', workflowsCreateTool],
    ['workflows_update', workflowsUpdateTool],
  ] as const

  for (const [name, tool] of toolCases) {
    it(`${name} does not teach the model an invented enum value`, () => {
      const description = tool.params.runs_on_incidents.description ?? ''

      /**
       * Split on everything but letters and underscores so `newly_created_and_active` stays one
       * token — only a standalone `active` or `all` trips this.
       */
      const tokens = new Set(description.toLowerCase().split(/[^a-z_]+/))
      for (const invented of INVENTED_VALUES) {
        expect(tokens.has(invented)).toBe(false)
      }
    })

    it(`${name} still names both real enum values`, () => {
      const description = tool.params.runs_on_incidents.description ?? ''
      for (const valid of RUNS_ON_INCIDENTS_ENUM) {
        expect(description).toContain(valid)
      }
    })
  }
})
