import {
  createV2ResourceConcealmentPolicy,
  v2OrchestrationErrorPolicy,
} from '@/lib/api/server/routes'

/**
 * `GET /logs` and `GET /billing/logs` both take a caller-named `workspaceId` and
 * answer differently when the caller cannot reach it: this list projects the
 * refusal as 403, while the billing family conceals it as 404. The split is
 * deliberate rather than an oversight, and worth stating because it is visible
 * to anyone probing both.
 *
 * 403 is the v2 default for a workspace-scoped read — every sibling list that
 * takes a `workspaceId` answers this way. It costs an existence bit on a random
 * workspace UUID, which is a weak oracle: a workspace API key cannot name a
 * workspace other than its own at all, so only a personal key can ask the
 * question, and it learns nothing beyond "this id exists". In exchange, a caller
 * that genuinely lost access to a workspace it already knows is told so, instead
 * of being sent to hunt for a resource sitting right there.
 *
 * The billing family declines that trade because what it reports is a payer
 * rather than workspace content; its own policy states why. Moving this list to
 * 404 to match would leave it disagreeing with `GET /workflows`, `GET /tables`,
 * and every other read over the same workspace — trading one visible
 * inconsistency for a larger one.
 */
export const v2LogErrorPolicies = {
  default: v2OrchestrationErrorPolicy,
  concealDetailAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Log not found',
  }),
} as const
