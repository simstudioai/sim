/** The upgrade card's `reason` for a payer whose plan does not include Chat. */
export const CHAT_PLAN_REQUIRED_REASON = 'plan_required' as const

/**
 * The card for a payer whose plan does not include Chat. Sim writes it at run admission, before
 * any worker run exists, so it never crosses the worker billing protocol: its reason widens only
 * the tag Sim renders, not the worker-shared card. The composer shows the same card before a send.
 */
export const CHAT_PLAN_REQUIRED_UPGRADE = {
  reason: CHAT_PLAN_REQUIRED_REASON,
  action: 'upgrade_plan',
  message: 'Chat is included on paid plans. Upgrade your plan to talk to Sim.',
} as const
