import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { authorizePublicFileShare, readPublicFileShare } from '@/lib/public-shares/application'

/** Social previews always use anonymous credentials, even when the viewer has an auth cookie. */
export async function readPublicFileSocialMetadata(token: string) {
  try {
    const auth = await authorizePublicFileShare({ token, credential: { method: 'GET' } })
    if (!auth.authorized) return { protected: true as const }
    return { protected: false as const, metadata: await readPublicFileShare({ grant: auth.grant }) }
  } catch (error) {
    if (asOrchestrationError(error)?.code === 'not_found') return null
    throw error
  }
}
