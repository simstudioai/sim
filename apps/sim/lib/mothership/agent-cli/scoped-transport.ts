import { NextRequest } from 'next/server'
import { markCopilotRequest } from '@/lib/api/server/routes/copilot-request'
import {
  dispatchInProcessV2Request,
  type MatchedRoute,
} from '@/lib/api/server/routes/in-process-transport'
import { tryMatchV2Route } from '@/lib/api/server/routes/v2-route-pattern'
import type { CopilotChatDelegationContext } from '@/lib/mothership/auth/application-delegation'

interface ScopedCliInvocation {
  admitRequest(
    request: NextRequest,
    route: MatchedRoute
  ): Response | undefined | Promise<Response | undefined>
}

/** Private admission uses only this validated in-process identity; public requests remain API-key authenticated. */
export function createScopedCliTransport(
  endpoint: string,
  invocation: CopilotChatDelegationContext | ScopedCliInvocation
): typeof fetch {
  const origin = new URL(endpoint).origin
  const scope = Object.freeze({ ...invocation })
  const unavailable = () => Response.json({ error: 'CLI target is unavailable' }, { status: 400 })
  return async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.origin !== origin || !url.pathname.startsWith('/api/v2/')) return unavailable()
    const forwarded = new NextRequest(request)
    if ('admitRequest' in scope) {
      const matched = tryMatchV2Route(url.pathname)
      if (!matched) return unavailable()
      const denied = await scope.admitRequest(forwarded, matched)
      if (denied) return denied
    } else {
      markCopilotRequest(forwarded, scope)
    }
    return (
      (await dispatchInProcessV2Request(forwarded)) ??
      Response.json({ error: 'API route or method unavailable' }, { status: 404 })
    )
  }
}
