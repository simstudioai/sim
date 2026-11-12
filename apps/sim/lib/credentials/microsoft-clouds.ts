/**
 * The Microsoft cloud instances a saved Microsoft app credential can sign in to. Each is a
 * separate Entra deployment with its own token endpoint and Microsoft Graph root, and its tokens
 * are not interchangeable with another cloud's. A credential saved without a cloud is `global`,
 * which every credential saved before national clouds existed is.
 *
 * Microsoft 365 GCC (moderate) tenants use the global endpoints; GCC High and DoD tenants use the
 * US Government ones.
 *
 * @see https://learn.microsoft.com/en-us/graph/deployments
 * @see https://learn.microsoft.com/en-us/entra/identity-platform/authentication-national-cloud
 */

export const MICROSOFT_CLOUD_IDS = ['global', 'usgov', 'usgov_dod', 'china'] as const

export type MicrosoftCloudId = (typeof MICROSOFT_CLOUD_IDS)[number]

interface MicrosoftCloud {
  /** Connect-dialog label. */
  label: string
  /** The Entra token service root (`<origin>/<tenant>/oauth2/v2.0/token`). */
  loginOrigin: string
  /** The Microsoft Graph service root, also the Graph token audience. */
  graphOrigin: string
}

export const MICROSOFT_CLOUDS: Record<MicrosoftCloudId, MicrosoftCloud> = {
  global: {
    label: 'Global (including GCC)',
    loginOrigin: 'https://login.microsoftonline.com',
    graphOrigin: 'https://graph.microsoft.com',
  },
  usgov: {
    label: 'US Government (GCC High)',
    loginOrigin: 'https://login.microsoftonline.us',
    graphOrigin: 'https://graph.microsoft.us',
  },
  usgov_dod: {
    label: 'US Government (DoD)',
    loginOrigin: 'https://login.microsoftonline.us',
    graphOrigin: 'https://dod-graph.microsoft.us',
  },
  china: {
    label: 'China (operated by 21Vianet)',
    // Microsoft Graph's deployment table lists login.chinacloudapi.cn; the Entra national-cloud
    // table, the identity platform's own reference, lists this one, which legacy inline Azure
    // Data Explorer sign-ins already use.
    loginOrigin: 'https://login.partner.microsoftonline.cn',
    graphOrigin: 'https://microsoftgraph.chinacloudapi.cn',
  },
}
