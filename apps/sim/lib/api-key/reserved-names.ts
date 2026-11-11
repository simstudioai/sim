/**
 * Names the server mints its own rolling delegation keys under. A user may not
 * create a key with one, so the minter can never adopt or rotate a user's key.
 */
export const DELEGATION_KEY_NAME_PREFIX = 'mothership-delegation:'
