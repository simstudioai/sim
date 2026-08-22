/**
 * Provider-config keys for the Gong webhook trigger.
 *
 * Separate from `providers/gong.ts` for the same reason as
 * `salesforce-payload.ts`: the Gong trigger definition is client-reachable
 * through the trigger registry, and the provider module reaches `@sim/security`
 * -> `node:crypto`, which Next polyfills to `crypto-browserify` in the browser.
 */
export const GONG_JWT_PUBLIC_KEY_CONFIG_KEY = 'gongJwtPublicKeyPem'
