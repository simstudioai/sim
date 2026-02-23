/**
 * Workflow call chain detection using the Via-style pattern.
 *
 * Prevents infinite execution loops when workflows call each other via API or
 * MCP endpoints. Each hop appends the current workflow ID to the `X-Sim-Via`
 * header; on ingress the chain is checked for depth.
 */

export const SIM_VIA_HEADER = 'X-Sim-Via'
export const MAX_CALL_CHAIN_DEPTH = 10

/**
 * Parses the `X-Sim-Via` header value into an ordered list of workflow IDs.
 * Returns an empty array when the header is absent or empty.
 */
export function parseCallChain(headerValue: string | null | undefined): string[] {
  if (!headerValue || !headerValue.trim()) {
    return []
  }
  return headerValue
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}

/**
 * Serializes a call chain array back into the header value format.
 */
export function serializeCallChain(chain: string[]): string {
  return chain.join(',')
}

/**
 * Validates that the call chain has not exceeded the maximum depth.
 * Returns an error message string if invalid, or `null` if the chain is
 * safe to extend.
 */
export function validateCallChain(chain: string[]): string | null {
  if (chain.length >= MAX_CALL_CHAIN_DEPTH) {
    return `Maximum workflow call chain depth (${MAX_CALL_CHAIN_DEPTH}) exceeded.`
  }

  return null
}

/**
 * Builds the next call chain by appending the current workflow ID.
 */
export function buildNextCallChain(chain: string[], workflowId: string): string[] {
  return [...chain, workflowId]
}
