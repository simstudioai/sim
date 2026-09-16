/** The team is a selection hint; linking requires a fresh admin-bound Slack authorization. */
export function slackSearchInstallPath(teamId: string) {
  if (!/^T[A-Z0-9]{1,199}$/.test(teamId)) throw new Error('Invalid Slack workspace ID')
  return `/slack-search/install/${teamId}`
}
