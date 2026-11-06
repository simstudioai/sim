import { toRecord } from '@sim/utils/object'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { HelpScoutListTeamsParams, HelpScoutListTeamsResponse } from '@/tools/helpscout/types'
import { HELPSCOUT_TEAM_PROPERTIES } from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  buildHelpScoutUrl,
  embeddedList,
  LIST_PAGE_OUTPUTS,
  PAGE_PARAM,
  projectPage,
  projectTeam,
  validatePage,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

export const helpScoutListTeamsTool: ToolConfig<
  HelpScoutListTeamsParams,
  HelpScoutListTeamsResponse
> = {
  id: 'helpscout_list_teams',
  name: 'Help Scout List Teams',
  description:
    'List the teams in the Help Scout account. Team IDs can be used to assign conversations.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    page: PAGE_PARAM,
  },
  request: {
    url: (params) =>
      buildHelpScoutUrl('/teams', {
        page: validatePage(params.page),
      }),
    method: 'GET',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
  },
  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        teams: embeddedList(data, 'teams').map(projectTeam),
        ...projectPage(data),
      },
    }
  },
  outputs: {
    teams: {
      type: 'array',
      description: 'Teams on this page',
      items: { type: 'object', properties: HELPSCOUT_TEAM_PROPERTIES },
    },
    ...LIST_PAGE_OUTPUTS,
  },
}
