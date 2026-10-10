/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { parseShapeNode } from '@/lib/pptx-renderer/model/nodes/shape-node'
import { parseXml } from '@/lib/pptx-renderer/parser/xml-parser'
import type { RenderContext } from '@/lib/pptx-renderer/renderer/render-context'
import { renderShape } from '@/lib/pptx-renderer/renderer/shape-renderer'

const EMPTY_NODE = parseXml(
  '<p:spTree xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" />'
)

function createContext(): RenderContext {
  const slide = {
    index: 0,
    nodes: [],
    layoutIndex: '',
    rels: new Map(),
    slidePath: 'ppt/slides/slide1.xml',
    showMasterSp: true,
  }

  return {
    presentation: {
      width: 960,
      height: 540,
      slides: [slide],
      layouts: new Map(),
      masters: new Map(),
      themes: new Map(),
      slideToLayout: new Map(),
      layoutToMaster: new Map(),
      masterToTheme: new Map(),
      media: new Map(),
      charts: new Map(),
      isWps: false,
    },
    slide,
    theme: {
      colorScheme: new Map(),
      majorFont: { latin: 'Calibri', ea: '', cs: '' },
      minorFont: { latin: 'Calibri', ea: '', cs: '' },
      fillStyles: [],
      lineStyles: [],
      effectStyles: [],
    },
    master: {
      colorMap: new Map(),
      textStyles: {},
      placeholders: [],
      spTree: EMPTY_NODE,
      rels: new Map(),
    },
    layout: {
      placeholders: [],
      spTree: EMPTY_NODE,
      rels: new Map(),
      showMasterSp: true,
    },
    mediaUrlCache: new Map(),
    colorCache: new Map(),
  }
}

describe('renderShape', () => {
  it('inserts the rect gradient blend group before the main path', () => {
    const node = parseShapeNode(
      parseXml(`
        <p:sp xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
              xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <p:nvSpPr><p:cNvPr id="2" name="Rect" /><p:cNvSpPr /><p:nvPr /></p:nvSpPr>
          <p:spPr>
            <a:xfrm><a:off x="0" y="0" /><a:ext cx="914400" cy="914400" /></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst /></a:prstGeom>
            <a:gradFill>
              <a:gsLst>
                <a:gs pos="0"><a:srgbClr val="FF0000" /></a:gs>
                <a:gs pos="100000"><a:srgbClr val="0000FF" /></a:gs>
              </a:gsLst>
              <a:path path="rect" />
            </a:gradFill>
          </p:spPr>
        </p:sp>
      `)
    )

    const svg = renderShape(node, createContext()).querySelector('svg')

    const blendGroup = svg?.querySelector(':scope > g[clip-path]')
    expect(blendGroup?.nextElementSibling?.localName).toBe('path')
    expect(blendGroup?.nextElementSibling?.getAttribute('fill')).toBe('none')
  })
})
