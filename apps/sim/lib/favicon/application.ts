import { defineOperation } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { defineAuthorizedCredentialUserUseCase } from '@/lib/credentials/application/authorized-user-use-case'
import { resolveFavicon } from '@/lib/favicon/resolve.server'

/** A site's icon for the signed-in user; a host with none anywhere is `not_found`. */
export const getFavicon = defineAuthorizedCredentialUserUseCase({
  // permission-group-exempt: A public site's icon reveals nothing the caller's permissions govern.
  operation: defineOperation({
    id: 'favicons.get',
    principalKinds: ['session'],
    capability: 'none',
  }),
  async execute({ input }: { input: { host: string } }) {
    const favicon = await resolveFavicon(input.host)
    if (favicon.kind !== 'hit') throw new OrchestrationError('not_found', 'No icon for this host')
    return favicon
  },
})
