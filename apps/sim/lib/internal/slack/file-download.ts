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
  if (isExternalSlackFile(file)) return undefined
  const candidate = [file.url_private_download, file.url_private].find(
    (value): value is string => typeof value === 'string' && value.length > 0
  )
  const url = candidate ? URL.parse(candidate) : null
  return url?.origin === SLACK_FILE_ORIGIN ? url : undefined
}

/** Whether a file was shared from another app, whose URL is that app's own host. */
export function isExternalSlackFile(file: Record<string, unknown>): boolean {
  return file.is_external === true || file.mode === 'external' || file.filetype === 'remote'
}

/**
 * Whether a redirect stays on Slack's file host. A hop elsewhere, such as the workspace sign-in
 * page Slack sends a token it will not serve, must be refused rather than read as the file.
 */
export function isSlackFileHost(target: string): boolean {
  return URL.parse(target)?.origin === SLACK_FILE_ORIGIN
}

/** Redirect guard for a Slack file download; see {@link isSlackFileHost}. */
export function assertSlackFileHost(target: string): void {
  if (!isSlackFileHost(target))
    throw new Error('Slack redirected the file download away from its file host')
}
