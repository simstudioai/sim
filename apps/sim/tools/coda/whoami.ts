import type { CodaAuthParams, CodaWhoamiResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaHeaders,
  codaOAuth,
  mapWorkspaceRef,
  type RawCodaWorkspaceReference,
  WORKSPACE_REF_PROPERTIES,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

interface RawWhoami {
  name: string
  loginId: string
  pictureLink?: string
  scoped?: boolean
  tokenName?: string
  workspace?: RawCodaWorkspaceReference
}

export const codaWhoamiTool: ToolConfig<CodaAuthParams, CodaWhoamiResponse> = {
  id: 'coda_whoami',
  name: 'Coda Get Current User',
  description: 'Get the user and default workspace behind the connected Coda API token',
  version: '1.0.0',
  oauth: codaOAuth,
  errorExtractor: ErrorExtractorId.CODA_ERRORS,

  params: { ...codaAuthParams },

  request: {
    url: () => buildCodaUrl('/whoami'),
    method: 'GET',
    retry: CODA_RETRY,
    headers: (params) => codaHeaders(params.accessToken),
  },

  transformResponse: async (response) => {
    const data = (await response.json()) as RawWhoami
    return {
      success: true,
      output: {
        name: data.name,
        loginId: data.loginId,
        pictureLink: data.pictureLink ?? null,
        scoped: data.scoped ?? null,
        tokenName: data.tokenName ?? null,
        workspace: mapWorkspaceRef(data.workspace),
      },
    }
  },

  outputs: {
    name: { type: 'string', description: 'Name of the user' },
    loginId: { type: 'string', description: 'Email address of the user' },
    pictureLink: { type: 'string', description: 'Link to the user avatar', optional: true },
    scoped: {
      type: 'boolean',
      description: 'Whether the token is restricted to specific docs or tables',
      optional: true,
    },
    tokenName: { type: 'string', description: 'Name of the API token', optional: true },
    workspace: {
      type: 'object',
      description: 'Default workspace of the user',
      optional: true,
      properties: WORKSPACE_REF_PROPERTIES,
    },
  },
}
