import { type FixtureHandler, type FixtureServer, serve } from './harness'

export interface SignedInOriginOptions {
  /** The HTML of every app page, served with the session cookie. */
  page: string
  /** Sees each request first; returns true when it answered it. */
  handle?: (...args: Parameters<FixtureHandler>) => boolean | Promise<boolean>
}

/**
 * A fixture Sim origin with a signed-in user: the shell treats the window as signed in only when
 * the session cookie is set and `/api/auth/get-session` returns a user. Every other `/api/` route
 * answers `{}`.
 */
export function serveSignedIn({ page, handle }: SignedInOriginOptions): Promise<FixtureServer> {
  return serve(async (request, response, url) => {
    if (handle && (await handle(request, response, url))) return
    if (url.pathname.startsWith('/api/')) {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        url.pathname === '/api/auth/get-session'
          ? JSON.stringify({ user: { id: 'fixture-user' }, session: { id: 'fixture-session' } })
          : '{}'
      )
      return
    }
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Set-Cookie': 'better-auth.session_token=fixture; HttpOnly; SameSite=Lax; Path=/',
    })
    response.end(page)
  })
}
