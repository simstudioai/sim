import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutGetOrganizationParams,
  HelpScoutGetOrganizationResponse,
} from '@/tools/helpscout/types'
import { HELPSCOUT_ORGANIZATION_PROPERTIES } from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  buildHelpScoutUrl,
  parseHelpScoutId,
  projectOrganization,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutGetOrganizationTool: ToolConfig<
  HelpScoutGetOrganizationParams,
  HelpScoutGetOrganizationResponse
> = {
  id: 'helpscout_get_organization',
  name: 'Help Scout Get Organization',
  description:
    'Get a Help Scout organization by ID, optionally with its customer and conversation counts and property values.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    organizationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Organization ID',
    },
    includeCounts: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include customer and conversation counts',
    },
    includeProperties: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include organization property values',
    },
  },
  request: {
    url: (params) =>
      buildHelpScoutUrl(
        `/organizations/${parseHelpScoutId(params.organizationId, 'organizationId')}`,
        {
          includeCounts: params.includeCounts ? 'true' : undefined,
          includeProperties: params.includeProperties ? 'true' : undefined,
        }
      ),
    method: 'GET',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
  },
  transformResponse: async (response) => ({
    success: true,
    output: { organization: projectOrganization(await response.json()) },
  }),
  outputs: {
    organization: {
      type: 'json',
      description: 'Organization details',
      properties: HELPSCOUT_ORGANIZATION_PROPERTIES,
    },
  },
}
