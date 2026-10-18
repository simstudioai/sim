import { isRecordLike } from '@sim/utils/object'
import { ACCESS_POLICY_OUTPUTS } from '@/tools/cloudflare/outputs'
import type {
  CloudflareAccessPolicyResponse,
  CloudflareUpdateAccessPolicyParams,
} from '@/tools/cloudflare/types'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  parseJsonArrayParam,
  parseJsonObjectParam,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const updateAccessPolicyTool: ToolConfig<
  CloudflareUpdateAccessPolicyParams,
  CloudflareAccessPolicyResponse
> = {
  id: 'cloudflare_update_access_policy',
  name: 'Cloudflare Update Access Policy',
  description:
    'Updates a Cloudflare Access (Zero Trust) policy on an application. Cloudflare does not document merge behavior for this PUT, so treat it as a replace: resend all settings to retain, including exclude, require, approval_groups, connection_rules, and mfa_config; omitted rules or security settings may be dropped and widen access. The change applies to live traffic immediately. Read the current policy with "List Access Policies" first. Requires an API token with Account Access: Apps and Policies Edit.',
  version: '1.0.0',

  params: {
    approval_groups: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array. Administrators who can approve a temporary authentication request. Fields: approvals_needed, email_addresses, email_list_uuid.',
    },
    connection_rules: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object. The rules that define how users may connect to the targets secured by your application. Fields: rdp, ssh.',
    },
    mfa_config: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON object. Configures multi-factor authentication (MFA) settings for infrastructure applications. Fields: allowed_authenticators, mfa_disabled, session_duration.',
    },
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
      `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/access/apps/${safeUrlPathSegment(params.appId, 'appId')}/policies/${safeUrlPathSegment(params.policyId, 'policyId')}`,
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

      if (params.approval_groups !== undefined && params.approval_groups !== '')
        body.approval_groups = parseJsonArrayParam(params.approval_groups, 'approval_groups')
      if (params.connection_rules !== undefined && params.connection_rules !== '')
        body.connection_rules = parseJsonObjectParam(params.connection_rules, 'connection_rules')
      if (params.mfa_config !== undefined && params.mfa_config !== '')
        body.mfa_config = parseJsonObjectParam(params.mfa_config, 'mfa_config')
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareFields(data.result, ACCESS_POLICY_OUTPUTS),
      ...(!success
        ? { error: cloudflareErrorMessage(data, 'Failed to update access policy') }
        : {}),
    }
  },
  outputs: ACCESS_POLICY_OUTPUTS,
}
