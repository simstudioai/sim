/** Shared container vocabulary; reading it never loads the workflow mutation engine. */
export const VALID_LOOP_TYPES = ['for', 'forEach', 'while', 'doWhile'] as const
export const VALID_PARALLEL_TYPES = ['count', 'collection'] as const
