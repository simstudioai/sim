import { NextRequest } from 'next/server'
import { markCopilotRequest } from '@/lib/api/server/routes/copilot-request'
import {
  dispatchInProcessV2Request,
  matchV2Route,
} from '@/lib/api/server/routes/in-process-transport'
import type { CopilotChatDelegationContext } from '@/lib/mothership/auth/application-delegation'

interface ScopedCliInvocation {
  admitRequest(
    request: NextRequest,
    route: NonNullable<ReturnType<typeof matchV2Route>>
  ): Response | undefined | Promise<Response | undefined>
}

/** Private admission uses only this validated in-process identity; public requests remain API-key authenticated. */
export function createScopedCliTransport(
  endpoint: string,
  invocation: CopilotChatDelegationContext | ScopedCliInvocation
): typeof fetch {
  const origin = new URL(endpoint).origin
  const scope = Object.freeze({ ...invocation })
  return async (input, init) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.origin !== origin || !url.pathname.startsWith('/api/v2/'))
      return Response.json({ error: 'CLI target is unavailable' }, { status: 400 })
    const forwarded = new NextRequest(request)
    if ('admitRequest' in scope) {
      let matched: ReturnType<typeof matchV2Route>
      try {
        matched = matchV2Route(url.pathname)
      } catch {
        return Response.json({ error: 'CLI target is unavailable' }, { status: 400 })
      }
      if (!matched) {
        return Response.json({ error: 'CLI target is unavailable' }, { status: 400 })
      }
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
