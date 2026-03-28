import { createContext, useContext } from 'react'

/**
 * Provides the list of block types the learner is allowed to add in a sandbox exercise.
 * Null means no constraint (all blocks allowed — the default outside sandbox mode).
 * An empty array means no blocks may be added (configure/connect pre-placed blocks only).
 */
export const SandboxBlockConstraintsContext = createContext<string[] | null>(null)

/** Returns the sandbox-allowed block types, or null if not in a sandbox context. */
export function useSandboxBlockConstraints(): string[] | null {
  return useContext(SandboxBlockConstraintsContext)
}
