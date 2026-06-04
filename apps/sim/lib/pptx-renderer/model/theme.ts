/**
 * Theme parser — extracts color scheme and font definitions from a:theme XML.
 */

import type { SafeXmlNode } from '../parser/xml-parser'

export interface ThemeData {
  colorScheme: Map<string, string>
  majorFont: { latin: string; ea: string; cs: string }
  minorFont: { latin: string; ea: string; cs: string }
  fillStyles: SafeXmlNode[] // from a:fillStyleLst children (indexed 1-based)
  lineStyles: SafeXmlNode[] // from a:lnStyleLst children (indexed 1-based)
  effectStyles: SafeXmlNode[] // from a:effectStyleLst children (indexed 1-based)
}

/** Known color scheme slot names in a:clrScheme. */
const COLOR_SLOTS = [
  'dk1',
  'dk2',
  'lt1',
  'lt2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hlink',
  'folHlink',
] as const

/**
 * Extract a hex color value from a color definition node.
 * Handles both `a:srgbClr@val` and `a:sysClr@lastClr`.
 */
function extractColor(node: SafeXmlNode): string | undefined {
  const srgb = node.child('srgbClr')
  if (srgb.exists()) {
    return srgb.attr('val')
  }
  const sys = node.child('sysClr')
  if (sys.exists()) {
    return sys.attr('lastClr') ?? sys.attr('val')
  }
  return undefined
}

/**
 * Parse font info from a majorFont or minorFont node.
 * Extracts typeface attributes from latin, ea, and cs child elements.
 */
function parseFontInfo(fontNode: SafeXmlNode): { latin: string; ea: string; cs: string } {
  return {
    latin: fontNode.child('latin').attr('typeface') ?? '',
    ea: fontNode.child('ea').attr('typeface') ?? '',
    cs: fontNode.child('cs').attr('typeface') ?? '',
  }
}

/**
 * Parse a theme XML root (`a:theme`) into ThemeData.
 */
export function parseTheme(root: SafeXmlNode): ThemeData {
  const themeElements = root.child('themeElements')

  // --- Color scheme ---
  const clrScheme = themeElements.child('clrScheme')
  const colorScheme = new Map<string, string>()

  for (const slot of COLOR_SLOTS) {
    const slotNode = clrScheme.child(slot)
    if (slotNode.exists()) {
      const hex = extractColor(slotNode)
      if (hex !== undefined) {
        colorScheme.set(slot, hex)
      }
    }
  }

  // --- Font scheme ---
  const fontScheme = themeElements.child('fontScheme')
  const majorFont = parseFontInfo(fontScheme.child('majorFont'))
  const minorFont = parseFontInfo(fontScheme.child('minorFont'))

  // --- Format scheme ---
  const fmtScheme = themeElements.child('fmtScheme')
  const fillStyleLst = fmtScheme.child('fillStyleLst')
  const fillStyles: SafeXmlNode[] = fillStyleLst.allChildren()
  const lnStyleLst = fmtScheme.child('lnStyleLst')
  const lineStyles: SafeXmlNode[] = lnStyleLst.allChildren()
  const effectStyleLst = fmtScheme.child('effectStyleLst')
  const effectStyles: SafeXmlNode[] = effectStyleLst.allChildren()

  return { colorScheme, majorFont, minorFont, fillStyles, lineStyles, effectStyles }
}
