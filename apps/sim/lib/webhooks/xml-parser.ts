import { XMLParser } from 'fast-xml-parser'

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '_text',
  parseAttributeValue: true,
  trimValues: true,
})

/**
 * Parses an XML string into a JSON object.
 * Attributes are preserved with '@_' prefix, text content uses '_text' key.
 */
export function parseXmlToJson(xml: string): Record<string, unknown> {
  return xmlParser.parse(xml) as Record<string, unknown>
}
