/**
 * Slide master parser — extracts color map, background, text styles,
 * and placeholder shapes from a p:sldMaster XML.
 */

import type { SafeXmlNode } from '../parser/xml-parser'
import { isPlaceholder, parseAllAttributes } from './xml-helpers'

export interface MasterData {
  colorMap: Map<string, string>
  background?: SafeXmlNode
  textStyles: {
    titleStyle?: SafeXmlNode
    bodyStyle?: SafeXmlNode
    otherStyle?: SafeXmlNode
  }
  defaultTextStyle?: SafeXmlNode
  placeholders: SafeXmlNode[]
  spTree: SafeXmlNode
  rels: Map<string, import('../parser/rel-parser').RelEntry>
}

/**
 * Extract placeholder shape nodes from an spTree node.
 * A shape is considered a placeholder if it has a `p:ph` element in its nvPr.
 */
function extractPlaceholders(spTree: SafeXmlNode): SafeXmlNode[] {
  const placeholders: SafeXmlNode[] = []
  const allChildren = spTree.allChildren()
  for (const child of allChildren) {
    if (isPlaceholder(child)) {
      placeholders.push(child)
    }
  }
  return placeholders
}

/**
 * Parse a slide master XML root (`p:sldMaster`) into MasterData.
 */
export function parseMaster(root: SafeXmlNode): MasterData {
  const cSld = root.child('cSld')

  // --- Background ---
  const bg = cSld.child('bg')
  const background = bg.exists() ? bg : undefined

  // --- Shape tree ---
  const spTree = cSld.child('spTree')

  // --- Color map ---
  const clrMap = root.child('clrMap')
  const colorMap = parseAllAttributes(clrMap)

  // --- Text styles ---
  const txStyles = root.child('txStyles')
  const titleStyle = txStyles.child('titleStyle')
  const bodyStyle = txStyles.child('bodyStyle')
  const otherStyle = txStyles.child('otherStyle')

  // --- Default text style ---
  const defaultTextStyle = root.child('defaultTextStyle')

  // --- Placeholders ---
  const placeholders = extractPlaceholders(spTree)

  return {
    colorMap,
    background,
    textStyles: {
      titleStyle: titleStyle.exists() ? titleStyle : undefined,
      bodyStyle: bodyStyle.exists() ? bodyStyle : undefined,
      otherStyle: otherStyle.exists() ? otherStyle : undefined,
    },
    defaultTextStyle: defaultTextStyle.exists() ? defaultTextStyle : undefined,
    placeholders,
    spTree,
    rels: new Map(), // populated later by buildPresentation
  }
}
