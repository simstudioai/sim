import { authParams } from '@/tools/servicenow/params'
import type {
  ServiceNowGetChangeNextStatesParams,
  ServiceNowGetChangeNextStatesResponse,
} from '@/tools/servicenow/types'
import {
  buildServiceNowHeaders,
  isRecord,
  normalizeInstanceUrl,
  parseServiceNowResponse,
  toRecordObject,
} from '@/tools/servicenow/utils'
import type { ToolConfig } from '@/tools/types'

export const getChangeNextStatesTool: ToolConfig<
  ServiceNowGetChangeNextStatesParams,
  ServiceNowGetChangeNextStatesResponse
> = {
  id: 'servicenow_get_change_next_states',
  name: 'Get ServiceNow Change Next States',
  description:
    "Read the states a ServiceNow change request can actually move to next, with the instance's own state-to-label map and the conditions each transition still has to meet. Use this instead of assuming the base-system state codes, which a customized change model can change.",
  version: '1.0.0',

  params: {
    ...authParams,
    changeSysId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'sys_id of the change request. Use Get ServiceNow Change Request to resolve a CHG number to its sys_id.',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = normalizeInstanceUrl(params.instanceUrl)
      const changeSysId = params.changeSysId?.trim()
      if (!changeSysId) {
        throw new Error('A change request sys_id is required')
      }
      return `${baseUrl}/api/sn_chg_rest/change/${changeSysId}/nextstates`
    },
    method: 'GET',
    headers: (params) => buildServiceNowHeaders(params),
  },

  transformResponse: async (response: Response) => {
    const data = await parseServiceNowResponse(response)
    const result = toRecordObject(data.result)

    const availableStates: string[] = Array.isArray(result.available_states)
      ? result.available_states.map((state: unknown) => String(state))
      : []
    const stateLabels: Record<string, string> = {}
    for (const [state, label] of Object.entries(toRecordObject(result.state_label))) {
      if (typeof label === 'string') stateLabels[state] = label
    }

    /**
     * ServiceNow groups `state_transitions` by target state, so it arrives as an
     * array of arrays. Each entry already carries its own `from_state` and
     * `to_state`, so flattening loses nothing and is far easier to consume.
     */
    const stateTransitions = (
      Array.isArray(result.state_transitions) ? result.state_transitions.flat() : []
    ).filter(isRecord)

    const allowedStates = [
      ...new Set(
        stateTransitions
          .filter((transition) => transition?.transition_available === true)
          .map((transition) => String(transition.to_state))
      ),
    ]

    return {
      success: true as const,
      output: {
        availableStates,
        allowedStates,
        stateLabels,
        stateTransitions,
        metadata: { transitionCount: stateTransitions.length },
      },
    }
  },

  outputs: {
    availableStates: {
      type: 'array',
      description:
        'Every state coded value reachable from the change request, including its current state',
      items: { type: 'string', description: 'State coded value' },
    },
    allowedStates: {
      type: 'array',
      description:
        'The subset of state coded values whose transition currently reports transition_available, meaning the change request already meets that transition conditions',
      items: { type: 'string', description: 'State coded value' },
    },
    stateLabels: {
      type: 'json',
      description:
        "Map of state coded value to the label this instance uses, e.g. {'0': 'Review'}. Read the state model from here rather than assuming the base-system codes",
    },
    stateTransitions: {
      type: 'array',
      description:
        'Available transitions, flattened from the per-target-state grouping ServiceNow returns. Empty for type-driven and legacy change requests, which do not report conditions',
      items: {
        type: 'object',
        properties: {
          sys_id: {
            type: 'string',
            description: 'Sys_id of the state transition record on sttrm_state_transition',
          },
          display_value: {
            type: 'string',
            description: 'Human-readable transition name, e.g. "Implement to Review"',
          },
          from_state: { type: 'string', description: 'State coded value moved from' },
          to_state: { type: 'string', description: 'State coded value moved to' },
          transition_available: {
            type: 'boolean',
            description: 'Whether the change request can move to this state right now',
          },
          automatic_transition: {
            type: 'boolean',
            description: 'Whether the change request moves to this state automatically',
          },
          conditions: {
            type: 'array',
            description: 'Conditions gating the transition, each with whether it has passed',
            items: {
              type: 'object',
              properties: {
                passed: {
                  type: 'boolean',
                  description: 'Whether the change request met this condition',
                },
                condition: {
                  type: 'json',
                  description: 'The condition as {name, description, sys_id}',
                },
              },
            },
          },
        },
      },
    },
    metadata: {
      type: 'json',
      description: 'Operation metadata',
      properties: {
        transitionCount: { type: 'number', description: 'Number of transitions returned' },
      },
    },
  },
}
