/**
 * The model the agent, router and evaluator blocks run when none is set, and the one sim-auto
 * resolves to when the model router cannot pick a pool model. Kept dependency-free so the
 * executor's constants can read it without loading the provider registry.
 */
export const DEFAULT_BLOCK_MODEL = 'claude-sonnet-5-5'
