/** The only host a Slack token is sent to when downloading a file's contents. */
const SLACK_FILE_ORIGIN = 'https://files.slack.com'

/**
 * Where to download a Slack-hosted file's bytes with a Slack token, or undefined when Slack does
 * not host it. `url_private_download` comes first: Slack answers a PDF's `url_private` with a
 * redirect to a sandboxed viewer on another domain, while the download URL serves the bytes from
 * its file host. A remote file's URL is whatever the app that shared it chose, so a file marked
 * external, or any URL off Slack's file host, never receives a token.
 */
export function slackFileDownloadUrl(file: Record<string, unknown>): URL | undefined {
  if (file.is_external === true || file.mode === 'external' || file.filetype === 'remote')
    return undefined
  const candidate = [file.url_private_download, file.url_private].find(
    (value): value is string => typeof value === 'string' && value.length > 0
  )
  const url = candidate ? URL.parse(candidate) : null
  return url?.origin === SLACK_FILE_ORIGIN ? url : undefined
}

/**
 * Redirect guard for a Slack file download: a hop off the file host, such as the workspace
 * sign-in page Slack sends a token it will not serve, is refused rather than read as the file.
 */
export function assertSlackFileHost(target: string): void {
  if (URL.parse(target)?.origin !== SLACK_FILE_ORIGIN)
    throw new Error('Slack redirected the file download away from its file host')
}
