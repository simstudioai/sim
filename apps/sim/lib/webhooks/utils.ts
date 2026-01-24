/**
 * Pure utility functions for webhook processing
 * This file has NO server-side dependencies to ensure it can be safely imported in client-side code
 */

/**
 * Convert square bracket notation to TwiML XML tags
 * Used by Twilio Voice tools to allow LLMs to generate TwiML without XML escaping issues
 *
 * @example
 * "[Response][Say]Hello[/Say][/Response]"
 * -> "<Response><Say>Hello</Say></Response>"
 */
export function convertSquareBracketsToTwiML(twiml: string | undefined): string | undefined {
  if (!twiml) {
    return twiml
  }
  // Replace [Tag] with <Tag> and [/Tag] with </Tag>
  return twiml.replace(/\[(\/?[^\]]+)\]/g, '<$1>')
}

/**
 * Merges fields from source into target, but only if they don't exist in the base config.
 * Used to preserve system-managed fields while respecting user-provided values.
 */
export function mergeNonUserFields(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  userProvided: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(source)) {
    if (!(key in userProvided)) {
      target[key] = value
    }
  }
}
