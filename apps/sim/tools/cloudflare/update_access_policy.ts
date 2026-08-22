import type {
  CloudflareAccessPolicyResponse,
  CloudflareUpdateAccessPolicyParams,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  emptyAccessPolicy,
  mapAccessPolicy,
  parseJsonArrayParam,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'

export const updateAccessPolicyTool: ToolConfig<
  CloudflareUpdateAccessPolicyParams,
  CloudflareAccessPolicyResponse
> = {
  id: 'cloudflare_update_access_policy',
  name: 'Cloudflare Update Access Policy',
  description:
    'Updates a Cloudflare Access (Zero Trust) policy on an application. Cloudflare does not document merge behavior for this PUT, so treat it as a replace: send every rule the policy should keep, because an omitted exclude or require rule may be dropped and widen who gets in. The change applies to live traffic immediately. Read the current policy with "List Access Policies" first. Requires an API token with Account Access: Apps and Policies Edit.',
  version: '1.0.0',

  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Cloudflare account ID. Access applications are account-scoped',
    },
    appId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Access application ID that owns the policy',
    },
    policyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Access policy ID to update',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the policy',
    },
    decision: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'What the policy does when it matches: allow, deny, non_identity, or bypass (skip Access entirely)',
    },
    include: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array of Access rules evaluated with OR logic. Example: [{"email_domain":{"domain":"example.com"}}]',
    },
    exclude: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of Access rules evaluated with NOT logic',
    },
    require: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of Access rules evaluated with AND logic',
    },
    precedence: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Evaluation order of the policy within the application',
    },
    sessionDuration: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'How long a session granted by this policy stays valid, e.g. 24h. Leave it unset on a policy attached to an infrastructure-typed application — Cloudflare rejects those with error 12130',
    },
    approvalRequired: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether an approver must grant each access request',
    },
    isolationRequired: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether the session must run in a remote isolated browser',
    },
    purposeJustificationRequired: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether users must state a reason for access',
    },
    purposeJustificationPrompt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Prompt shown when a justification is required',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API Token',
    },
  },

  request: {
    url: (params) =>
      `https://api.cloudflare.com/client/v4/accounts/${params.accountId.trim()}/access/apps/${params.appId.trim()}/policies/${params.policyId.trim()}`,
    method: 'PUT',
    headers: (params) => cloudflareHeaders(params.apiKey),
    body: (params) => {
      const include = parseJsonArrayParam(params.include, 'Include Rules')
      if (!include || include.length === 0) {
        throw new Error('Include Rules must contain at least one Access rule')
      }

      const body: Record<string, unknown> = {
        name: params.name,
        decision: params.decision,
        include,
      }

      const exclude = parseJsonArrayParam(params.exclude, 'Exclude Rules')
      if (exclude) body.exclude = exclude

      const require = parseJsonArrayParam(params.require, 'Require Rules')
      if (require) body.require = require

      if (params.precedence !== undefined) body.precedence = params.precedence
      if (params.sessionDuration) body.session_duration = params.sessionDuration
      if (params.approvalRequired !== undefined) body.approval_required = params.approvalRequired
      if (params.isolationRequired !== undefined) body.isolation_required = params.isolationRequired
      if (params.purposeJustificationRequired !== undefined) {
        body.purpose_justification_required = params.purposeJustificationRequired
      }
      if (params.purposeJustificationPrompt) {
        body.purpose_justification_prompt = params.purposeJustificationPrompt
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: emptyAccessPolicy(),
        error: cloudflareErrorMessage(data, 'Failed to update Access policy'),
      }
    }

    return { success: true, output: mapAccessPolicy(data.result) }
  },

  outputs: {
    id: { type: 'string', description: 'Policy identifier' },
    name: { type: 'string', description: 'Policy name', optional: true },
    decision: {
      type: 'string',
      description: 'Decision the policy applies: allow, deny, non_identity, or bypass',
      optional: true,
    },
    precedence: {
      type: 'number',
      description: 'Evaluation order of the policy within the application',
      optional: true,
    },
    include: { type: 'json', description: 'Rules evaluated with OR logic', optional: true },
    exclude: { type: 'json', description: 'Rules evaluated with NOT logic', optional: true },
    require: { type: 'json', description: 'Rules evaluated with AND logic', optional: true },
    session_duration: {
      type: 'string',
      description: 'How long a session granted by this policy stays valid',
      optional: true,
    },
    approval_required: {
      type: 'boolean',
      description: 'Whether an approver must grant each access request',
      optional: true,
    },
    isolation_required: {
      type: 'boolean',
      description: 'Whether the session must run in a remote browser',
      optional: true,
    },
    purpose_justification_required: {
      type: 'boolean',
      description: 'Whether users must state a reason for access',
      optional: true,
    },
    purpose_justification_prompt: {
      type: 'string',
      description: 'Prompt shown when a justification is required',
      optional: true,
    },
    created_at: { type: 'string', description: 'Creation timestamp', optional: true },
    updated_at: { type: 'string', description: 'Last update timestamp', optional: true },
  },
}
