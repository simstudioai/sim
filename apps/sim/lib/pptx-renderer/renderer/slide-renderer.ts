/**
 * Slide renderer — orchestrates rendering of a complete slide with all its nodes.
 */

import type { ECharts } from 'echarts'
import type { BaseNodeData } from '../model/nodes/base-node'
import type { ChartNodeData } from '../model/nodes/chart-node'
import { type GroupNodeData, parseGroupNode } from '../model/nodes/group-node'
import { type PicNodeData, parsePicNode } from '../model/nodes/pic-node'
import { parseShapeNode, type ShapeNodeData } from '../model/nodes/shape-node'
import { parseTableNode, type TableNodeData } from '../model/nodes/table-node'
import type { PresentationData } from '../model/presentation'
import type { SlideData } from '../model/slide'
import type { SafeXmlNode } from '../parser/xml-parser'
import { renderBackground } from './background-renderer'
import { renderChart } from './chart-renderer'
import { renderGroup } from './group-renderer'
import { renderImage } from './image-renderer'
import { createRenderContext, type RenderContext } from './render-context'
import { renderShape } from './shape-renderer'
import { renderTable } from './table-renderer'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlideRendererOptions {
  /** Called when a single node fails to render. */
  onNodeError?: (nodeId: string, error: unknown) => void
  /**
   * Navigation callback for shape-level hyperlink actions (action buttons, etc.).
   * Called with target slide index (0-based) for slide jumps,
   * or with a URL string for external links.
   */
  onNavigate?: (target: { slideIndex?: number; url?: string }) => void
  /** Shared media URL cache for blob URL reuse across slides. */
  mediaUrlCache?: Map<string, string>
  /** Shared set of live ECharts instances for explicit disposal. */
  chartInstances?: Set<ECharts>
}

/**
 * Per-slide resource handle returned by `renderSlide()`.
 * Allows the caller to dispose of slide-specific resources (chart instances,
 * blob URLs in standalone mode) without tearing down the whole viewer.
 */
export interface SlideHandle {
  /** The rendered slide DOM element. */
  readonly element: HTMLElement
  /** Dispose slide-specific resources (charts inside this slide, blob URLs if standalone). */
  dispose(): void
  /** Support `using` declarations (TC39 Explicit Resource Management). */
  [Symbol.dispose](): void
}

// ---------------------------------------------------------------------------
// Node Dispatch
// ---------------------------------------------------------------------------

/**
 * Dispatch a typed node to its appropriate renderer.
 * This function is also passed into GroupRenderer for recursive child rendering.
 */
function renderNode(node: BaseNodeData, ctx: RenderContext): HTMLElement {
  switch (node.nodeType) {
    case 'shape':
      return renderShape(node as ShapeNodeData, ctx)
    case 'picture':
      return renderImage(node as PicNodeData, ctx)
    case 'table':
      return renderTable(node as TableNodeData, ctx)
    case 'group':
      return renderGroup(node as GroupNodeData, ctx, renderNode)
    case 'chart':
      return renderChart(node as ChartNodeData, ctx)
    default: {
      // Unknown node type — render as empty positioned div
      const el = document.createElement('div')
      el.style.position = 'absolute'
      el.style.left = `${node.position.x}px`
      el.style.top = `${node.position.y}px`
      el.style.width = `${node.size.w}px`
      el.style.height = `${node.size.h}px`
      return el
    }
  }
}

// ---------------------------------------------------------------------------
// Error Placeholder
// ---------------------------------------------------------------------------

/**
 * Create a visual error placeholder at the node's position.
 */
function createErrorPlaceholder(node: BaseNodeData): HTMLElement {
  const el = document.createElement('div')
  el.style.position = 'absolute'
  el.style.left = `${node.position.x}px`
  el.style.top = `${node.position.y}px`
  el.style.width = `${node.size.w}px`
  el.style.height = `${node.size.h}px`
  el.style.border = '2px dashed #ff4444'
  el.style.backgroundColor = 'rgba(255,68,68,0.08)'
  el.style.display = 'flex'
  el.style.alignItems = 'center'
  el.style.justifyContent = 'center'
  el.style.color = '#cc0000'
  el.style.fontSize = '11px'
  el.style.fontFamily = 'monospace'
  el.style.overflow = 'hidden'
  el.style.boxSizing = 'border-box'
  el.style.padding = '4px'
  el.textContent = `Render Error`
  el.title = `Failed to render node: ${node.id} (${node.name})`
  return el
}

// ---------------------------------------------------------------------------
// Master/Layout Shape Parsing
// ---------------------------------------------------------------------------

/**
 * Check whether a shape node is a placeholder (has p:ph in nvPr).
 */
function isPlaceholderNode(node: SafeXmlNode): boolean {
  for (const wrapper of ['nvSpPr', 'nvPicPr', 'nvGrpSpPr', 'nvGraphicFramePr', 'nvCxnSpPr']) {
    const nv = node.child(wrapper)
    if (nv.exists()) {
      const nvPr = nv.child('nvPr')
      if (nvPr.child('ph').exists()) return true
    }
  }
  return false
}

/**
 * Parse and collect renderable shapes from a master or layout spTree.
 * Only includes NON-placeholder shapes (decorative elements, logos, footers).
 * Placeholder shapes are never rendered from master/layout — they only serve
 * as position/size inheritance templates.
 */
function parseTemplateShapes(spTree: SafeXmlNode, _slideNodes: BaseNodeData[]): BaseNodeData[] {
  const nodes: BaseNodeData[] = []
  if (!spTree || !spTree.exists || !spTree.exists()) return nodes

  for (const child of spTree.allChildren()) {
    const tag = child.localName

    // Skip ALL placeholder shapes — they're templates, not renderable content
    if (isPlaceholderNode(child)) continue

    try {
      let node: BaseNodeData | undefined
      switch (tag) {
        case 'sp':
        case 'cxnSp':
          node = parseShapeNode(child)
          break
        case 'pic':
          node = parsePicNode(child)
          break
        case 'grpSp':
          node = parseGroupNode(child)
          break
        case 'graphicFrame': {
          const graphic = child.child('graphic')
          const graphicData = graphic.child('graphicData')
          if (graphicData.child('tbl').exists()) {
            node = parseTableNode(child)
          }
          break
        }
      }
      // Skip empty/invisible nodes (0x0 size and no text)
      if (node && (node.size.w > 0 || node.size.h > 0)) {
        nodes.push(node)
      }
    } catch {
      // Skip unparseable template shapes silently
    }
  }
  return nodes
}

// ---------------------------------------------------------------------------
// Main Slide Render Function
// ---------------------------------------------------------------------------

/**
 * Render a complete slide into an HTML element.
 *
 * Rendering order:
 * 1. Background (slide → layout → master inheritance)
 * 2. Master non-placeholder shapes (behind everything)
 * 3. Layout non-placeholder shapes
 * 4. Slide shapes (on top)
 */
export function renderSlide(
  presentation: PresentationData,
  slide: SlideData,
  options?: SlideRendererOptions
): SlideHandle {
  const isSharedCache = !!options?.mediaUrlCache

  // Create render context (resolves slide -> layout -> master -> theme chain)
  const ctx = createRenderContext(
    presentation,
    slide,
    options?.mediaUrlCache,
    options?.chartInstances
  )
  if (options?.onNavigate) {
    ctx.onNavigate = options.onNavigate
  }

  // Create slide container
  const container = document.createElement('div')
  container.style.position = 'relative'
  container.style.width = `${presentation.width}px`
  container.style.height = `${presentation.height}px`
  container.style.overflow = 'hidden'
  container.style.backgroundColor = '#FFFFFF'

  // Render background
  try {
    renderBackground(ctx, container)
  } catch (e) {
    options?.onNodeError?.('__background__', e)
  }

  // --- Render master template shapes (behind layout and slide) ---
  // Respect showMasterSp flags:
  //  - layout.showMasterSp === false  → skip master shapes
  //  - slide.showMasterSp === false   → skip both master AND layout shapes
  if (slide.showMasterSp && ctx.layout.showMasterSp) {
    const masterCtx: RenderContext = {
      ...ctx,
      slide: { ...ctx.slide, rels: ctx.master.rels },
    }
    const masterShapes = parseTemplateShapes(ctx.master.spTree, slide.nodes)
    for (const node of masterShapes) {
      try {
        const el = renderNode(node, masterCtx)
        container.appendChild(el)
      } catch {
        // Master shape errors are non-fatal
      }
    }
  }

  // --- Render layout template shapes ---
  if (slide.showMasterSp) {
    const layoutCtx: RenderContext = {
      ...ctx,
      slide: { ...ctx.slide, rels: ctx.layout.rels },
    }
    const layoutShapes = parseTemplateShapes(ctx.layout.spTree, slide.nodes)
    for (const node of layoutShapes) {
      try {
        const el = renderNode(node, layoutCtx)
        container.appendChild(el)
      } catch {
        // Layout shape errors are non-fatal
      }
    }
  }

  // --- Render slide shapes (on top) ---
  for (const node of slide.nodes) {
    try {
      const el = renderNode(node, ctx)
      container.appendChild(el)
    } catch (e) {
      options?.onNodeError?.(node.id, e)
      container.appendChild(createErrorPlaceholder(node))
    }
  }

  // Build SlideHandle
  let disposed = false
  const chartInstances = options?.chartInstances
  const mediaUrlCache = ctx.mediaUrlCache

  const dispose = (): void => {
    if (disposed) return
    disposed = true

    // Dispose chart instances whose DOM is inside this slide container
    if (chartInstances) {
      for (const chart of chartInstances) {
        if (!chart.isDisposed() && container.contains(chart.getDom())) {
          chart.dispose()
          chartInstances.delete(chart)
        }
      }
    }

    // Revoke blob URLs only in standalone mode (caller doesn't own a shared cache)
    if (!isSharedCache) {
      for (const url of mediaUrlCache.values()) {
        URL.revokeObjectURL(url)
      }
      mediaUrlCache.clear()
    }
  }

  return {
    element: container,
    dispose,
    [Symbol.dispose](): void {
      dispose()
    },
  }
}
