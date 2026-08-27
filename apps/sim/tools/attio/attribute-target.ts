/**
 * The `target` path parameter shared by Attio's attribute routes.
 *
 * Attio's OpenAPI (https://api.attio.com/openapi/api) declares `target` on
 * `/v2/{target}/{identifier}/attributes` and its sub-routes as
 * `{"type":"string","enum":["objects","lists"]}`. The Attio block presents it
 * as a dropdown, but the block is only one caller: the parameter is
 * `visibility: 'user-or-llm'`, so a direct tool call never passes through the
 * dropdown.
 *
 * {@link safeUrlPathSegment} does not cover this. It rejects separators and dot
 * segments, so traversal is already closed — but `workspace_members`,
 * `webhooks`, and `tasks` are separator-free single segments that satisfy it
 * while re-aiming the request, and the caller's Attio bearer token travels with
 * it. An enum is only enforceable where the enum is known, which is here.
 */
const ATTRIBUTE_TARGETS = ['objects', 'lists'] as const

export type AttioAttributeTarget = (typeof ATTRIBUTE_TARGETS)[number]

/**
 * Narrows a caller-supplied `target` to a value Attio documents.
 *
 * The comparison is exact — Attio's route table is case-sensitive, so accepting
 * `Objects` would only trade a clear error for a 404.
 *
 * @param value - The raw parameter, typically LLM- or user-supplied.
 * @returns The value, narrowed to the documented union.
 * @throws If the value is not exactly `objects` or `lists`.
 */
export function safeAttributeTarget(value: unknown): AttioAttributeTarget {
  if (typeof value === 'string' && (ATTRIBUTE_TARGETS as readonly string[]).includes(value)) {
    return value as AttioAttributeTarget
  }

  throw new Error(`target must be one of: ${ATTRIBUTE_TARGETS.join(', ')}`)
}
