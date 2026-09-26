/**
 * Fork/sync limits shared by the server paths that enforce them and the client surfaces
 * that must not offer an action past them.
 *
 * Separate from `copy/deploy-bridge.ts`, which owns the enforcement: that module imports
 * `@sim/db` and drizzle, so a `'use client'` component reading the constant from there
 * would pull the database client into the browser bundle.
 */

/**
 * Hard ceiling on how many deployed workflows one fork/promote loads into memory at once
 * (each as a full `WorkflowState`). There is no per-workspace workflow cap in the product,
 * so this is the safety valve: real workspaces hold tens to low hundreds, making this
 * ~5-10x headroom that never blocks legitimate use, it sits below the fork feature's other
 * item caps (resource selection 2000, mapping entries 5000 - both lighter-weight than full
 * states), and it bounds a pathological workspace to a few hundred MB of transient state
 * instead of an unbounded load.
 */
export const MAX_FORK_DEPLOYED_WORKFLOWS = 1000
