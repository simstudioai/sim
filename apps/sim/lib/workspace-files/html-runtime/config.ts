import { getDomain } from 'tldts'

/** Validate origin configuration without importing server dependencies into the proxy. */
export function htmlContentOrigin(value: string | undefined, appOrigin: string): string {
  if (!value) throw new Error('HTML_CONTENT_ORIGIN is required for workflow-backed HTML files')
  const content = new URL(value)
  const app = new URL(appOrigin)
  if (content.origin !== value.replace(/\/$/, '') || content.username || content.password)
    throw new Error('HTML_CONTENT_ORIGIN must be an origin without a path or credentials')
  if (content.origin === app.origin || content.hostname === app.hostname)
    throw new Error('HTML content must use a separate host from the application')
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(content.hostname)
  const localApp = ['localhost', '127.0.0.1', '[::1]'].includes(app.hostname)
  if (content.protocol !== 'https:' && !(local && localApp && content.protocol === 'http:'))
    throw new Error('HTML content requires HTTPS, except on localhost')
  if (!local && getDomain(content.hostname) === getDomain(app.hostname))
    throw new Error('HTML content must use a separate registrable domain from the application')
  return content.origin
}
