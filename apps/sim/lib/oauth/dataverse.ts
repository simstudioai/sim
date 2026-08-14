import type { OAuthResourceUrlConfig } from '@/lib/oauth/types'

/**
 * The one description of a Dataverse environment host.
 *
 * Two places depend on it and must not drift: the OAuth scope names this origin
 * as the token's audience, and every Web API request is pinned to it. If
 * Microsoft adds a sovereign cloud and only one side learns about it, the result
 * is a token whose audience the tool then refuses to send to.
 *
 * Suffixes are the registrable domains Microsoft serves environments from —
 * commercial and regional clouds (`*.crm[N].dynamics.com`), China (21Vianet),
 * US Government and DoD, and the legacy German cloud. Matching the registrable
 * domain rather than each regional `crmN` prefix keeps new Microsoft regions
 * working without a code change.
 */
export const DATAVERSE_RESOURCE_URL: OAuthResourceUrlConfig = {
  title: 'Environment URL',
  placeholder: 'https://myorg.crm.dynamics.com',
  hint: 'Find this in Power Platform admin center under your environment.',
  allowedHostSuffixes: [
    '.dynamics.com',
    '.dynamics.cn',
    '.dynamics.de',
    '.microsoftdynamics.us',
    '.appsplatform.us',
  ],
  scopeSuffix: '/user_impersonation',
}
