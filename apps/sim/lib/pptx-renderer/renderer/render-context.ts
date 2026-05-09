/**
 * Render context — provides resolved theme/master/layout chain for a given slide.
 */

import type { ECharts } from 'echarts'
import type { LayoutData } from '../model/layout'
import type { MasterData } from '../model/master'
import type { PresentationData } from '../model/presentation'
import type { SlideData } from '../model/slide'
import type { ThemeData } from '../model/theme'
import type { SafeXmlNode } from '../parser/xml-parser'

export interface RenderContext {
  presentation: PresentationData
  slide: SlideData
  theme: ThemeData
  master: MasterData
  layout: LayoutData
  mediaUrlCache: Map<string, string> // path -> blob URL
  colorCache: Map<string, { color: string; alpha: number }>
  /** Shared set of live ECharts instances for explicit disposal. */
  chartInstances?: Set<ECharts>
  /** Fill node from parent group's grpSpPr, used to resolve `a:grpFill` in children. */
  groupFillNode?: SafeXmlNode
  /**
   * Navigation callback for shape-level hyperlink actions (action buttons, clickable shapes).
   * Called with target slide index (0-based) for `ppaction://hlinksldjump`,
   * or with a URL string for external links.
   */
  onNavigate?: (target: { slideIndex?: number; url?: string }) => void
}

export function createRenderContext(
  presentation: PresentationData,
  slide: SlideData,
  mediaUrlCache?: Map<string, string>,
  chartInstances?: Set<ECharts>
): RenderContext {
  // Resolve the chain: slide -> layout -> master -> theme
  const layoutPath = presentation.slideToLayout.get(slide.index) || ''
  const masterPath = presentation.layoutToMaster.get(layoutPath) || ''
  const themePath = presentation.masterToTheme.get(masterPath) || ''

  const layout: LayoutData = presentation.layouts.get(layoutPath) || {
    placeholders: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    spTree: {} as any,
    rels: new Map(),
    showMasterSp: true,
  }

  const master: MasterData = presentation.masters.get(masterPath) || {
    colorMap: new Map(),
    textStyles: {},
    placeholders: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    spTree: {} as any,
    rels: new Map(),
  }

  const theme: ThemeData = presentation.themes.get(themePath) || {
    colorScheme: new Map(),
    majorFont: { latin: 'Calibri', ea: '', cs: '' },
    minorFont: { latin: 'Calibri', ea: '', cs: '' },
    fillStyles: [],
    lineStyles: [],
    effectStyles: [],
  }

  return {
    presentation,
    slide,
    theme,
    master,
    layout,
    mediaUrlCache: mediaUrlCache ?? new Map(),
    colorCache: new Map(),
    chartInstances,
  }
}
