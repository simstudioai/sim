/** Setup can navigate only within Sim or to GitHub's approval pages. */
export function resolveGitHubSetupUrl(value: string, origin: string): string {
  const url = new URL(value, origin)
  if (
    url.username ||
    url.password ||
    (url.origin !== origin && !(url.protocol === 'https:' && url.hostname === 'github.com'))
  ) {
    throw new Error('GitHub returned an invalid setup URL')
  }
  return url.href
}
