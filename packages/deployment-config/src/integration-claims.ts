import { INTEGRATION_TOTALS } from '@sim/deployment-config/integration-totals'
import { formatLowerBound } from '@sim/utils/formatting'

/**
 * Sim's public integration-count claims for marketing copy, docs, metadata,
 * llms.txt, and JSON-LD, derived from the generated catalog totals so every
 * surface counts in the same unit: an integration is one app or service, and an
 * action is one operation an agent can call on it.
 */
export const INTEGRATION_COUNT_LABEL = formatLowerBound(INTEGRATION_TOTALS.integrations)
export const INTEGRATION_ACTION_COUNT_LABEL = formatLowerBound(INTEGRATION_TOTALS.actions)
export const INTEGRATION_TRIGGER_COUNT_LABEL = formatLowerBound(INTEGRATION_TOTALS.triggers)

/** Integration breadth in both units, e.g. "270+ integrations (5,400+ actions)". */
export const INTEGRATION_REACH = `${INTEGRATION_COUNT_LABEL} integrations (${INTEGRATION_ACTION_COUNT_LABEL} actions)`
