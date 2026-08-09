import { attackProperties } from '@/tools/dynatrace/outputs'
import type { DynatraceGetAttackParams, DynatraceGetAttackResponse } from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  encodeDynatraceId,
  mapAttack,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

/**
 * Every optional property of the attack detail endpoint. Dynatrace omits them
 * unless they are requested, so without this default the entry point, payload,
 * attacker, and exploited vulnerability the tool maps would all be null.
 */
const ATTACK_DETAIL_FIELDS = [
  '+attackTarget',
  '+request',
  '+entrypoint',
  '+vulnerability',
  '+securityProblem',
  '+attacker',
  '+managementZones',
].join(',')

export const getAttackTool: ToolConfig<DynatraceGetAttackParams, DynatraceGetAttackResponse> = {
  id: 'dynatrace_get_attack',
  name: 'Dynatrace Get Attack',
  description:
    'Get a single attack with its entry point, payload, attacker, and the vulnerability it exploited.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.DYNATRACE_ERRORS,

  params: {
    environmentUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Dynatrace environment URL (e.g., https://abc12345.live.dynatrace.com, or https://your-activegate:9999/e/abc12345 for Managed)',
    },
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dynatrace access token (dt0c01...) with the attacks.read scope',
    },
    attackId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the attack',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated optional properties to include, each prefixed with +. Defaults to all of them: +attackTarget, +request, +entrypoint, +vulnerability, +securityProblem, +attacker, +managementZones',
    },
  },

  request: {
    url: (params) =>
      buildDynatraceUrl(params.environmentUrl, `/attacks/${encodeDynatraceId(params.attackId)}`, {
        fields: params.fields || ATTACK_DETAIL_FIELDS,
      }),
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)

    return {
      success: true,
      output: {
        attack: mapAttack(data),
      },
    }
  },

  outputs: {
    attack: {
      type: 'object',
      description: 'The requested attack',
      properties: attackProperties,
    },
  },
}
