/**
 * Retries attaching a Team buyer's workspaces to their team when the delivery that created or
 * re-homed the team could not, while the team still carries its pending-attach marker. Apart from
 * the handler so the outbox registry does not load billing.
 */
export const TEAM_PLAN_WORKSPACE_ATTACH_EVENT = 'billing.team-plan-workspace-attach'
