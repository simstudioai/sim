/** One invitation authorizes and stamps each workspace, so the fan-out is bounded. */
export const MAX_INVITE_WORKSPACES = 50

/** Email delivery is intentionally sequential so partial failures remain attributable. */
export const MAX_INVITE_EMAILS = 100
