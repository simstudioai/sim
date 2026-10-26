import { isRecordLike } from '@sim/utils/object'
import type {
  TailscaleTailnetSettings,
  TailscaleUpdateTailnetSettingsParams,
  TailscaleUpdateTailnetSettingsResponse,
} from '@/tools/tailscale/types'
import { assertTailscaleResponse } from '@/tools/tailscale/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const tailscaleUpdateTailnetSettingsTool: ToolConfig<
  TailscaleUpdateTailnetSettingsParams,
  TailscaleUpdateTailnetSettingsResponse
> = {
  id: 'tailscale_update_tailnet_settings',
  name: 'Tailscale Update Tailnet Settings',
  description: 'Update selected tailnet settings',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Tailscale API access token or OAuth access token (not an auth key or OAuth client secret)',
    },
    tailnet: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Tailnet ID, legacy name, or "-" for the token’s default tailnet',
    },
    settings: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON object of settings to update; omitted settings remain unchanged',
    },
  },
  request: {
    url: (params) =>
      `https://api.tailscale.com/api/v2/tailnet/${safeUrlPathSegment(params.tailnet, 'tailnet')}/settings`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey.trim()}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const value: unknown = JSON.parse(params.settings)
      if (!isRecordLike(value)) throw new Error('settings must be a JSON object')
      if ('regionalRoutingOn' in value && 'routeSelection' in value)
        throw new Error('Set routeSelection or regionalRoutingOn, not both')
      return value
    },
  },
  transformResponse: async (response) => {
    await assertTailscaleResponse(response)
    const data: TailscaleTailnetSettings = await response.json()
    return {
      success: true,
      output: {
        settings: {
          aclsExternallyManagedOn: data.aclsExternallyManagedOn ?? null,
          aclsExternalLink: data.aclsExternalLink ?? null,
          adminConsoleSessionTimeoutMinutes: data.adminConsoleSessionTimeoutMinutes ?? null,
          devicesApprovalOn: data.devicesApprovalOn ?? null,
          devicesAutoUpdatesOn: data.devicesAutoUpdatesOn ?? null,
          devicesKeyDurationDays: data.devicesKeyDurationDays ?? null,
          usersApprovalOn: data.usersApprovalOn ?? null,
          usersRoleAllowedToJoinExternalTailnets:
            data.usersRoleAllowedToJoinExternalTailnets ?? null,
          networkFlowLoggingOn: data.networkFlowLoggingOn ?? null,
          regionalRoutingOn: data.regionalRoutingOn ?? null,
          routeSelection: data.routeSelection ?? null,
          postureIdentityCollectionOn: data.postureIdentityCollectionOn ?? null,
          httpsEnabled: data.httpsEnabled ?? null,
        },
      },
    }
  },
  outputs: {
    settings: {
      type: 'json',
      description: 'Settings for a tailnet',
      properties: {
        aclsExternallyManagedOn: {
          type: 'boolean',
          description:
            'Prevents users from editing policies in the admin console to avoid conflicts with external management workflows like GitOps or Terraform',
          nullable: true,
        },
        aclsExternalLink: {
          type: 'string',
          description:
            'Link to the external tailnet policy definition or management solution for this tailnet',
          nullable: true,
        },
        adminConsoleSessionTimeoutMinutes: {
          type: 'number',
          description:
            'The [admin console session timeout](/docs/account/admin-console-session-timeout) for members of this tailnet',
          nullable: true,
        },
        devicesApprovalOn: {
          type: 'boolean',
          description:
            'Whether [device approval](/docs/features/access-control/device-management/device-approval) is enabled for the tailnet',
          nullable: true,
        },
        devicesAutoUpdatesOn: {
          type: 'boolean',
          description:
            'Whether [auto updates](/docs/features/client/update#auto-updates) are enabled for devices that belong to this tailnet',
          nullable: true,
        },
        devicesKeyDurationDays: {
          type: 'number',
          description:
            'The [key expiry](/docs/features/access-control/key-expiry) duration for devices on this tailnet',
          nullable: true,
        },
        usersApprovalOn: {
          type: 'boolean',
          description:
            'Whether [user approval](/docs/features/access-control/user-approval) is enabled for this tailnet',
          nullable: true,
        },
        usersRoleAllowedToJoinExternalTailnets: {
          type: 'string',
          description:
            'Which user roles are allowed to [join external tailnets](/docs/features/sharing/how-to/invite-any-user)',
          nullable: true,
        },
        networkFlowLoggingOn: {
          type: 'boolean',
          description:
            'Whether [network flog logs](/docs/features/logging/network-flow-logs) are enabled for the tailnet',
          nullable: true,
        },
        regionalRoutingOn: {
          type: 'boolean',
          description:
            'Whether [regional routing](/docs/features/route-selection#regional-routing) is enabled for the tailnet',
          nullable: true,
        },
        routeSelection: {
          type: 'string',
          description:
            'The [route selection](/docs/features/route-selection) algorithm used by the tailnet: * `active-passive-failover` - Active-passive failover (formerly known as "Failover") * `regional-routing` - Regional routing * `regional-routing-failover` - Regional routing with in-region failover * `magicroute` - MagicRoute A PATCH request must not specify both the `regionalRoutingOn` and `routeSelection` fields',
          nullable: true,
        },
        postureIdentityCollectionOn: {
          type: 'boolean',
          description:
            'Whether [identity collection](/docs/features/access-control/device-management/how-to/manage-identity) is enabled for [device posture](/docs/features/device-posture) integrations for the tailnet',
          nullable: true,
        },
        httpsEnabled: {
          type: 'boolean',
          description:
            'Whether provisioning of [HTTPS certificates](/docs/how-to/set-up-https-certificates) is enabled for this tailnet',
          nullable: true,
        },
      },
    },
  },
}
