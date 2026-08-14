import {
  attackProperties,
  nextPageKeyOutput,
  pageSizeOutput,
  totalCountOutput,
} from '@/tools/dynatrace/outputs'
import type {
  DynatraceListAttacksParams,
  DynatraceListAttacksResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  mapAttack,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const listAttacksTool: ToolConfig<DynatraceListAttacksParams, DynatraceListAttacksResponse> =
  {
    id: 'dynatrace_list_attacks',
    name: 'Dynatrace List Attacks',
    description:
      'List runtime attacks Dynatrace Application Protection detected — injection attempts, their source, and whether they were blocked.',
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
      attackSelector: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Attack selector, e.g. state("EXPLOITED"),attackType("SQL_INJECTION"),technology("JAVA")',
      },
      from: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Start of the timeframe as UTC milliseconds, ISO 8601, or a relative expression such as now-7d. Defaults to now-30d',
      },
      to: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'End of the timeframe in the same formats as From. Defaults to now',
      },
      fields: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Comma-separated optional properties to include: +attackTarget, +request, +entrypoint, +vulnerability, +securityProblem, +attacker, +managementZones, +affectedEntities',
      },
      sort: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Sort by displayId, displayName, attackType, state, sourceIp, requestPath, or timestamp with a + or - prefix',
      },
      pageSize: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Attacks per page (max 500, default 100)',
      },
      nextPageKey: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Cursor for the next page. All other filters are ignored when it is set',
      },
    },

    request: {
      url: (params) =>
        params.nextPageKey
          ? buildDynatraceUrl(params.environmentUrl, '/attacks', {
              nextPageKey: params.nextPageKey,
            })
          : buildDynatraceUrl(params.environmentUrl, '/attacks', {
              attackSelector: params.attackSelector,
              from: params.from,
              to: params.to,
              fields: params.fields,
              sort: params.sort,
              pageSize: params.pageSize,
            }),
      method: 'GET',
      headers: (params) => dynatraceHeaders(params.apiToken),
    },

    transformResponse: async (response: Response) => {
      const data = await readJsonBody(response)
      const attacks = Array.isArray(data.attacks)
        ? (data.attacks as Array<Record<string, unknown>>)
        : []

      return {
        success: true,
        output: {
          attacks: attacks.map(mapAttack),
          totalCount: (data.totalCount as number) ?? null,
          pageSize: (data.pageSize as number) ?? null,
          nextPageKey: (data.nextPageKey as string) ?? null,
        },
      }
    },

    outputs: {
      attacks: {
        type: 'array',
        description: 'Matching attacks',
        items: { type: 'object', properties: attackProperties },
      },
      totalCount: totalCountOutput,
      pageSize: pageSizeOutput,
      nextPageKey: nextPageKeyOutput,
    },
  }
