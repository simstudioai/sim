/**
 * TwiML Utility Functions
 *
 * Pure utility functions for TwiML processing that can be used in any context
 * (client, server, tools, webhooks, etc.)
 */

/**
 * Convert TwiML written with square brackets to proper XML with angle brackets
 * This allows users to write TwiML without conflicting with block reference syntax
 *
 * @example
 * Input:  "[Response][Say]Hello[/Say][/Response]"
 * Output: "<Response><Say>Hello</Say></Response>"
 */
export function convertSquareBracketsToTwiML(twiml: string | undefined): string | undefined {
  if (!twiml) {
    return twiml
  }

  // Replace [Tag] with <Tag> and [/Tag] with </Tag>
  return twiml.replace(/\[(\/?[^\]]+)\]/g, '<$1>')
}
