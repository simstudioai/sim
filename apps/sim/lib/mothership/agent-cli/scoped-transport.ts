import { NextRequest } from 'next/server'
import { markCopilotRequest } from '@/lib/api/server/routes/copilot-request'
import { dispatchInProcessV2Request } from '@/lib/api/server/routes/in-process-transport'
import type { CopilotChatDelegationContext } from '@/lib/mothership/auth/application-delegation'

/** Private admission uses only this validated in-process identity; public requests remain API-key authenticated. */
export function createScopedCliTransport(
  endpoint: string,
  invocation: CopilotChatDelegationContext
): typeof fetch {
  const origin = new URL(endpoint).origin
  return async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.origin !== origin || !url.pathname.startsWith('/api/v2/'))
      return Response.json({ error: 'CLI target is unavailable' }, { status: 400 })
    const forwarded = new NextRequest(request)
    markCopilotRequest(forwarded, invocation)
    return (
      (await dispatchInProcessV2Request(forwarded)) ??
      Response.json({ error: 'API route or method unavailable' }, { status: 404 })
    )
  }
}
