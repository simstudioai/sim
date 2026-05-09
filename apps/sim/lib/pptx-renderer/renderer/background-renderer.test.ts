/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { parseXml } from '@/lib/pptx-renderer/parser/xml-parser'
import { renderBackground } from '@/lib/pptx-renderer/renderer/background-renderer'
import type { RenderContext } from '@/lib/pptx-renderer/renderer/render-context'

const EMPTY_NODE = parseXml(
  '<p:spTree xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" />'
)

function createContext(backgroundXml: string): RenderContext {
  const background = parseXml(backgroundXml)
  const slide = {
    index: 0,
    nodes: [],
    background,
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
      colorScheme: new Map([['bg1', '000000']]),
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

describe('renderBackground', () => {
  it('renders bgRef colors that resolve to black after modifiers', () => {
    const ctx = createContext(`
      <p:bg xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <p:bgRef idx="1001">
          <a:schemeClr val="bg1">
            <a:shade val="50000" />
          </a:schemeClr>
        </p:bgRef>
      </p:bg>
    `)
    const container = document.createElement('div')

    renderBackground(ctx, container)

    expect(container.style.backgroundColor).toBe('rgb(0, 0, 0)')
  })

  it('keeps bgRef without a color node on the white fallback', () => {
    const ctx = createContext(`
      <p:bg xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:bgRef idx="1001" />
      </p:bg>
    `)
    const container = document.createElement('div')

    renderBackground(ctx, container)

    expect(container.style.backgroundColor).toBe('rgb(255, 255, 255)')
  })
})
