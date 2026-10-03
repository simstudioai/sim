import {
  protectedResourceMetadataResponse,
  withOAuthResourceChallenge,
} from '@/lib/auth/oauth-protected-resource'
import { OAUTH_SEARCH_SCOPES } from '@/lib/auth/oauth-provider'

export function searchMcpResourceMetadata(resource: string) {
  return protectedResourceMetadataResponse({
    resource,
    name: 'Sim Search',
    scopes: OAUTH_SEARCH_SCOPES,
  })
}

export function withSearchMcpAuthChallenge<T extends Response>(response: T, resource: string): T {
  return withOAuthResourceChallenge(response, { resource, scopes: OAUTH_SEARCH_SCOPES })
}
