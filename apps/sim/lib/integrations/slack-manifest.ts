const SLACK_APP_NAME_MAX_LENGTH = 35
export const SLACK_APP_CREATION_URL_MAX_LENGTH = 30_000

/** Opens Slack's app creation flow with the generated manifest already filled in. */
export function buildSlackAppCreationUrl(manifest: string): string {
  return `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(manifest)}`
}

/** Validates a name used for both the Slack app and its bot user. */
export function getSlackAppNameError(name: string): string | null {
  const trimmedName = name.trim()
  if (!trimmedName) return 'Enter an app name.'
  if (trimmedName.length > SLACK_APP_NAME_MAX_LENGTH) {
    return `Use ${SLACK_APP_NAME_MAX_LENGTH} characters or fewer.`
  }
  if (!/^[a-zA-Z0-9 ._-]+$/.test(trimmedName)) {
    return 'Use letters, numbers, spaces, periods, hyphens, or underscores.'
  }
  return null
}
