import type { CodaAddPermissionParams, CodaAddPermissionResponse } from '@/tools/coda/types'
import {
  buildCodaUrl,
  CODA_RETRY,
  codaAuthParams,
  codaDocPath,
  codaHeaders,
  codaOAuth,
  DOC_ID_PARAM,
  optionalTrimmed,
} from '@/tools/coda/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

const PRINCIPAL_FIELD = {
  email: 'email',
  group: 'groupId',
  domain: 'domain',
  workspace: 'workspaceId',
} as const

export const codaAddPermissionTool: ToolConfig<CodaAddPermissionParams, CodaAddPermissionResponse> =
  {
    id: 'coda_add_permission',
    name: 'Coda Share Doc',
    description:
      'Share a Coda doc with a user, group, domain, workspace, or anyone with the link. Sharing with an email sends a notification unless suppressed.',
    version: '1.0.0',
    oauth: codaOAuth,
    errorExtractor: ErrorExtractorId.CODA_ERRORS,

    params: {
      ...codaAuthParams,
      docId: DOC_ID_PARAM,
      access: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Access level to grant: "readonly", "comment", or "write"',
      },
      principalType: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Who to share with: "email", "group", "domain", "workspace", or "anyone"',
      },
      principal: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Email address, group ID, domain, or workspace ID matching principalType. Not used for "anyone".',
      },
      suppressEmail: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Do not send a sharing notification email',
      },
    },

    request: {
      url: (params) => buildCodaUrl(codaDocPath(params.docId, 'acl', 'permissions')),
      method: 'POST',
      retry: CODA_RETRY,
      headers: (params) => codaHeaders(params.accessToken, true),
      body: (params) => {
        const type = params.principalType
        let principal: Record<string, string>
        if (type === 'anyone') {
          principal = { type }
        } else {
          const field = Object.hasOwn(PRINCIPAL_FIELD, type)
            ? PRINCIPAL_FIELD[type as keyof typeof PRINCIPAL_FIELD]
            : undefined
          if (!field) {
            throw new Error('principalType must be one of: email, group, domain, workspace, anyone')
          }
          const value = optionalTrimmed(params.principal)
          if (!value) throw new Error(`principal is required when principalType is "${type}"`)
          principal = { type, [field]: value }
        }
        return {
          access: params.access,
          principal,
          ...(typeof params.suppressEmail === 'boolean'
            ? { suppressEmail: params.suppressEmail }
            : {}),
        }
      },
    },

    transformResponse: async (_response, params) => ({
      success: true,
      output: {
        docId: String(params?.docId ?? '').trim(),
        access: params?.access ?? '',
        principalType: params?.principalType ?? '',
      },
    }),

    outputs: {
      docId: { type: 'string', description: 'ID of the shared doc' },
      access: { type: 'string', description: 'Access level granted' },
      principalType: { type: 'string', description: 'Type of principal the doc was shared with' },
    },
  }
