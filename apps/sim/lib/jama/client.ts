/** Keeps the credential's HTTPS instance and optional deployment context path together. */
export function normalizeJamaInstanceUrl(value: string): string {
  const url = URL.parse(value.trim())
  if (
    !url ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /%(?:2f|5c|2e)/i.test(url.pathname) ||
    /\/rest(?:\/|$)/i.test(url.pathname)
  ) {
    throw new Error('Enter your Jama HTTPS instance URL, without an API path')
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}
