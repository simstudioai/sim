/**
 * Pure utility functions for TwiML processing
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
