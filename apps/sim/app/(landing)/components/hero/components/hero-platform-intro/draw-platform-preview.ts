const SVG_NS = 'http://www.w3.org/2000/svg'
const SVG_GEOMETRY = 'path, rect, circle, ellipse, line, polyline, polygon'
const CONTENT_REVEAL_AT = 2_700
const CONTENT_REVEAL_DURATION = 550
const REGION_START = { sidebar: 1_100, workspace: 1_900 } as const

type PreviewRegion = keyof typeof REGION_START

/** Draws the shell, sidebar, and composer in order, then crossfades once into the real UI. */
export function drawPlatformPreview(
  root: HTMLDivElement,
  content: HTMLDivElement,
  overlay: SVGSVGElement,
  animations: Animation[]
) {
  const bounds = root.getBoundingClientRect()
  /** The overlay bleeds one pixel past the root so it can trace the region's border box. */
  overlay.setAttribute('viewBox', `-1 -1 ${bounds.width + 2} ${bounds.height + 2}`)
  overlay.replaceChildren()

  const animate = (element: Element, frames: Keyframe[], options: KeyframeAnimationOptions) => {
    const animation = element.animate(frames, { fill: 'both', ...options })
    animations.push(animation)
    return animation
  }
  const regionOf = (element: Element): PreviewRegion =>
    element.closest('[data-preview-sidebar]') ? 'sidebar' : 'workspace'

  const outline = document.createElementNS(SVG_NS, 'g')
  outline.setAttribute('fill', 'none')
  outline.setAttribute('stroke', 'var(--text-subtle)')
  outline.setAttribute('stroke-width', '1')
  outline.setAttribute('stroke-opacity', '0.65')
  overlay.appendChild(outline)

  const drawOutline = (
    rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
    edge: string,
    radius: number,
    delay: number,
    duration: number
  ) => {
    if (!rect.width || !rect.height) return
    const x = rect.left - bounds.left
    const y = rect.top - bounds.top
    const shape = document.createElementNS(SVG_NS, edge === 'frame' ? 'rect' : 'path')
    if (edge === 'frame') {
      shape.setAttribute('x', String(x + 0.5))
      shape.setAttribute('y', String(y + 0.5))
      shape.setAttribute('width', String(Math.max(0, rect.width - 1)))
      shape.setAttribute('height', String(Math.max(0, rect.height - 1)))
      shape.setAttribute('rx', String(radius))
    } else {
      const edgeY = edge === 'bottom' ? y + rect.height : y
      shape.setAttribute(
        'd',
        edge === 'left' ? `M ${x} ${y} V ${y + rect.height}` : `M ${x} ${edgeY} H ${x + rect.width}`
      )
    }
    shape.setAttribute('pathLength', '1')
    shape.setAttribute('stroke-dasharray', '1')
    shape.setAttribute('stroke-dashoffset', '1')
    outline.appendChild(shape)
    animate(shape, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
      duration,
      delay,
      easing: 'ease-in-out',
    })
  }

  /**
   * The root sits inside the region's 1px border, so the frame is drawn one
   * pixel out to land on that border rather than a hairline inside it.
   */
  drawOutline(
    {
      left: bounds.left - 1,
      top: bounds.top - 1,
      width: bounds.width + 2,
      height: bounds.height + 2,
    },
    'frame',
    8,
    0,
    1_200
  )
  content.querySelectorAll<HTMLElement>('[data-preview-outline]').forEach((element) => {
    if (element.closest('[data-preview-collapsed]')) return
    const composer = element.hasAttribute('data-preview-composer')
    drawOutline(
      element.getBoundingClientRect(),
      element.dataset.previewOutline ?? 'frame',
      Number.parseFloat(getComputedStyle(element).borderRadius) || 0,
      composer ? 1_700 : 650,
      composer ? 750 : 950
    )
  })
  const sidebarFooter = content.querySelector<HTMLElement>(
    '[data-preview-sidebar] > div > div:last-child'
  )
  if (sidebarFooter) drawOutline(sidebarFooter.getBoundingClientRect(), 'top', 0, 1_100, 500)
  const tabs = content.querySelector<HTMLElement>('[role="tablist"]')
  if (tabs && !tabs.closest('[data-preview-collapsed]'))
    drawOutline(tabs.getBoundingClientRect(), 'bottom', 0, 1_700, 500)

  const skeleton = document.createElementNS(SVG_NS, 'g')
  skeleton.setAttribute('data-preview-skeleton', '')
  skeleton.setAttribute('fill', 'var(--surface-6)')
  overlay.appendChild(skeleton)
  const skeletonCount = { sidebar: 0, workspace: 0 }
  const addSkeleton = (rect: DOMRect, region: PreviewRegion, width = rect.width) => {
    if (!rect.width || !rect.height) return
    const bar = document.createElementNS(SVG_NS, 'rect')
    bar.setAttribute('x', String(rect.left - bounds.left))
    bar.setAttribute('y', String(rect.top - bounds.top + (rect.height - 7) / 2))
    bar.setAttribute('width', String(width))
    bar.setAttribute('height', '7')
    bar.setAttribute('rx', '3.5')
    bar.setAttribute('opacity', '0')
    skeleton.appendChild(bar)
    animate(bar, [{ opacity: 0 }, { opacity: 0.7 }], {
      duration: 240,
      delay: REGION_START[region] + Math.min(skeletonCount[region] * 35, 280),
      easing: 'ease-out',
    })
    skeletonCount[region] += 1
  }
  content
    .querySelectorAll<HTMLElement>(
      '[data-preview-sidebar] span, [role="tab"] span, [data-preview-skeleton-label]'
    )
    .forEach((label) => {
      if (label.closest('[data-preview-collapsed]')) return
      if (label.children.length || (label.textContent?.trim().length ?? 0) < 2) return
      const range = document.createRange()
      range.selectNodeContents(label)
      addSkeleton(range.getBoundingClientRect(), regionOf(label))
    })
  const composer = content.querySelector('textarea')?.getBoundingClientRect()
  if (composer) addSkeleton(composer, 'workspace', Math.min(120, composer.width * 0.42))

  const icons = document.createElementNS(SVG_NS, 'g')
  icons.setAttribute('data-preview-icons', '')
  overlay.appendChild(icons)
  const iconCount = { sidebar: 0, workspace: 0 }
  content.querySelectorAll<SVGSVGElement>('svg').forEach((source) => {
    if (source.closest('[data-preview-collapsed]')) return
    const rect = source.getBoundingClientRect()
    if (!rect.width || !rect.height || rect.width > 40 || rect.height > 40) return
    const region = regionOf(source)
    const copy = source.cloneNode(true) as SVGSVGElement
    copy.setAttribute('x', String(rect.left - bounds.left))
    copy.setAttribute('y', String(rect.top - bounds.top))
    copy.setAttribute('width', String(rect.width))
    copy.setAttribute('height', String(rect.height))
    copy.setAttribute('aria-hidden', 'true')
    const shapes = copy.querySelectorAll<SVGGeometryElement>(SVG_GEOMETRY)
    const originals = source.querySelectorAll<SVGGeometryElement>(SVG_GEOMETRY)
    const delay = REGION_START[region] + Math.min(iconCount[region] * 35, 280)
    shapes.forEach((shape, index) => {
      const original = originals[index]
      if (!original) return
      const style = getComputedStyle(original)
      const filled = style.fill !== 'none'
      const outlined = style.stroke !== 'none'
      if (!filled && !outlined) return
      shape.setAttribute('pathLength', '1')
      shape.setAttribute('stroke-dasharray', '1')
      shape.setAttribute('stroke-dashoffset', '1')
      shape.setAttribute('stroke', outlined ? style.stroke : style.color)
      shape.setAttribute('stroke-width', outlined ? style.strokeWidth : '1')
      shape.setAttribute('fill', style.fill)
      shape.setAttribute('fill-opacity', '0')
      animate(
        shape,
        [
          { strokeDashoffset: 1, fillOpacity: 0, strokeOpacity: 1 },
          { strokeDashoffset: 0, fillOpacity: 0, strokeOpacity: 1, offset: 0.75 },
          { strokeDashoffset: 0, fillOpacity: filled ? 1 : 0, strokeOpacity: outlined ? 1 : 0 },
        ],
        { duration: 500, delay, easing: 'ease-in-out' }
      )
    })
    icons.appendChild(copy)
    iconCount[region] += 1
  })

  const handoff = {
    duration: CONTENT_REVEAL_DURATION,
    delay: CONTENT_REVEAL_AT,
    easing: 'linear',
  }
  animate(overlay, [{ opacity: 1 }, { opacity: 0 }], handoff)
  return animate(content, [{ opacity: 0 }, { opacity: 1 }], handoff)
}
