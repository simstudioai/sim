/**
 * Sim's public integration-count claim, as written in marketing copy, metadata,
 * llms.txt, and JSON-LD ("Connect 1,000+ integrations"). It counts individual
 * integration actions, so it is intentionally not derived from the block
 * catalog length. Every surface reads it from here so the claim never drifts.
 */
export const INTEGRATION_COUNT_LABEL = '1,000+'
