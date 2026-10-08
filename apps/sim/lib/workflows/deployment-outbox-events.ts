export const WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS = {
  PREPARE_V2: 'workflow.deployment.prepare.v2',
  /** One-release rolling compatibility for events admitted by pre-v2 pods. */
  SYNC_ACTIVE_SIDE_EFFECTS: 'workflow.deployment.sync-active-side-effects',
  /** One-release rolling compatibility for cleanup admitted by pre-v2 pods. */
  CLEANUP_INACTIVE_SIDE_EFFECTS: 'workflow.deployment.cleanup-inactive-side-effects',
  CLEANUP_UNDEPLOYED_SIDE_EFFECTS: 'workflow.deployment.cleanup-undeployed-side-effects',
} as const
