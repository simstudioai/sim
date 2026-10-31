import { defineOperation } from '@/lib/core/application'
import { defineAuthorizedCredentialUserUseCase } from '@/lib/credentials/application/authorized-user-use-case'
import { resolveFavicon } from '@/lib/favicon/resolve.server'

/** A site's icon for the signed-in user, or why there is none to serve. */
export const getFavicon = defineAuthorizedCredentialUserUseCase({
  // permission-group-exempt: A public site's icon reveals nothing the caller's permissions govern.
  operation: defineOperation({
    id: 'favicons.get',
    principalKinds: ['session'],
    capability: 'none',
  }),
  execute: ({ input }: { input: { host: string } }) => resolveFavicon(input.host),
})
