/** Whether a destination must bypass the local application router. */
export function isAbsoluteHref(href: string): boolean {
  return /^https?:\/\//.test(href)
}
