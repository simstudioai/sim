import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'

export const organizationSearchChatOperation = defineOrganizationOperation({
  id: 'knowledge.chat',
  oauthScope: 'search:read',
  minimumRole: 'member',
  principalKinds: ['session', 'personal_api_key', 'oauth_access_token'],
  capability: 'copilot.use',
})
