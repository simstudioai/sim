import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  HARMONIC_CONTACT_OUTPUT_PROPERTIES,
  type HarmonicScoutPerson,
  type HarmonicSearchPeopleScoutParams,
  type HarmonicSearchPeopleScoutResponse,
} from '@/tools/harmonic/types'
import {
  buildScoutBody,
  HARMONIC_API_BASE,
  harmonicHeaders,
  normalizeScoutPerson,
  nullableResponseString,
  responseArray,
  responseRecord,
} from '@/tools/harmonic/utils'
import type { ToolConfig } from '@/tools/types'

export const harmonicSearchPeopleScoutTool: ToolConfig<
  HarmonicSearchPeopleScoutParams,
  HarmonicSearchPeopleScoutResponse
> = {
  id: 'harmonic_search_people_scout',
  name: 'Harmonic Search People with Scout',
  description:
    'Ask Harmonic Scout to find people using natural language and return a stable, workflow-ready contacts table.',
  version: '1.0.0',
  oauth: { required: true, provider: 'harmonic' },
  errorExtractor: ErrorExtractorId.HARMONIC_ERRORS,

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Harmonic credential resolved by the connected account',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Natural-language people research request, e.g. "Find forward-deployed engineers in enterprise software"',
    },
  },

  request: {
    url: `${HARMONIC_API_BASE}/scout/tasks/wait`,
    method: 'POST',
    headers: (params) => harmonicHeaders(params.accessToken, { json: true }),
    body: (params) => buildScoutBody(params.query),
    modelInput: {
      mode: 'project',
      select: (params) => ({ query: params.query }),
    },
  },

  transformResponse: async (response) => {
    const data = responseRecord(await response.json(), 'Scout task')
    const taskId = nullableResponseString(data.task_id)
    const status = nullableResponseString(data.status)
    if (!taskId || !status) throw new Error('Harmonic Scout returned an invalid task response')

    if (status !== 'success') {
      const detail = typeof data.content === 'string' ? data.content.trim() : ''
      throw new Error(
        `Harmonic Scout task ${taskId} ended with status "${status}"${detail ? `: ${detail}` : ''}`
      )
    }

    const content = responseRecord(data.content, 'Scout content')
    const contacts = responseArray(content.people, 'Scout people').map((person) =>
      normalizeScoutPerson(responseRecord(person, 'Scout person') as HarmonicScoutPerson)
    )

    return {
      success: true,
      output: { contacts, taskId, status, count: contacts.length },
    }
  },

  outputs: {
    contacts: {
      type: 'array',
      description: 'People matching the Scout request, normalized for downstream workflow use',
      items: { type: 'object', properties: HARMONIC_CONTACT_OUTPUT_PROPERTIES },
    },
    taskId: { type: 'string', description: 'Harmonic Scout task identifier' },
    status: { type: 'string', description: 'Final Scout task status (success)' },
    count: { type: 'number', description: 'Number of contacts returned' },
  },
}
