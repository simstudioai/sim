import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'

export const mentionOperations = {
  /**
   * What a chat composer may name with `@` or `/`, across the viewer's workspaces in one
   * organization. Each family is read through its own workspace operation, so a workspace role or
   * permission group that hides a family hides it here too.
   */
  search: defineOrganizationOperation({
    id: 'organization.mentions.search',
    minimumRole: 'member',
    principalKinds: ['session'],
    capability: 'copilot.use',
  }),
} as const
