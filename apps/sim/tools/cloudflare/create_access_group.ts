import { isRecordLike } from '@sim/utils/object'
import type {
  CloudflareCreateAccessGroupParams,
  CloudflareCreateAccessGroupResponse,
} from '@/tools/cloudflare/operation-types'
import { ACCESS_GROUP_OUTPUTS } from '@/tools/cloudflare/outputs'
import {
  cloudflareErrorMessage,
  cloudflareHeaders,
  mapCloudflareFields,
  parseJsonArrayParam,
  readCloudflareResponse,
} from '@/tools/cloudflare/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const createAccessGroupTool: ToolConfig<
  CloudflareCreateAccessGroupParams,
  CloudflareCreateAccessGroupResponse
> = {
  id: 'cloudflare_create_access_group',
  name: 'Cloudflare Create Access Group',
  description: 'Creates a new Access group.',
  version: '1.0.0',
  params: {
    accountId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Account id',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cloudflare API token',
    },
    exclude: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array. Rules evaluated with a NOT logical operator. To match a policy, a user cannot meet any of the Exclude rules. Fields: group, any_valid_service_token, auth_context, auth_method, azureAD, certificate, common_name, geo, device_posture, email_domain, email_list, email, everyone, external_evaluation, github-organization, gsuite, login_method, ip_list, ip, okta, saml, oidc, service_token, linked_app_token, user_risk_score, cloudflare_account_member.',
    },
    include: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON array. Rules evaluated with an OR logical operator. A user needs to meet only one of the Include rules. Fields: group, any_valid_service_token, auth_context, auth_method, azureAD, certificate, common_name, geo, device_posture, email_domain, email_list, email, everyone, external_evaluation, github-organization, gsuite, login_method, ip_list, ip, okta, saml, oidc, service_token, linked_app_token, user_risk_score, cloudflare_account_member.',
    },
    is_default: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether this is the default group',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the Access group.',
    },
    require: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON array. Rules evaluated with an AND logical operator. To match a policy, a user must meet all of the Require rules. Fields: group, any_valid_service_token, auth_context, auth_method, azureAD, certificate, common_name, geo, device_posture, email_domain, email_list, email, everyone, external_evaluation, github-organization, gsuite, login_method, ip_list, ip, okta, saml, oidc, service_token, linked_app_token, user_risk_score, cloudflare_account_member.',
    },
  },
  request: {
    url: (params) =>
      `https://api.cloudflare.com/client/v4/accounts/${safeUrlPathSegment(params.accountId, 'accountId')}/access/groups`,
    method: 'POST',
    headers: (params) => ({ ...cloudflareHeaders(params.apiKey) }),
    body: (params) => ({
      exclude: parseJsonArrayParam(params.exclude, 'exclude'),
      include: parseJsonArrayParam(params.include, 'include'),
      is_default: params.is_default,
      name: params.name,
      require: parseJsonArrayParam(params.require, 'require'),
    }),
  },
  transformResponse: async (response) => {
    const data = await readCloudflareResponse(response)
    const success = response.ok && data.success === true && isRecordLike(data.result)
    return {
      success,
      output: mapCloudflareFields(data.result, ACCESS_GROUP_OUTPUTS),
      ...(!success ? { error: cloudflareErrorMessage(data, 'Failed to create access group') } : {}),
    }
  },
  outputs: ACCESS_GROUP_OUTPUTS,
}
