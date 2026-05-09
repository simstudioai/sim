import type { ECharts } from 'echarts'
import { buildPresentation, type PresentationData } from '../model/presentation'
import type { ZipParseLimits } from '../parser/zip-parser'
import { parseZip } from '../parser/zip-parser'
import type { SlideHandle } from '../renderer/slide-renderer'
import { renderSlide as renderSlideInternal } from '../renderer/slide-renderer'
import { isAllowedExternalUrl } from '../utils/url-safety'

export type { SlideHandle } from '../renderer/slide-renderer'

export type FitMode = 'contain' | 'none'

export type PreviewInput = ArrayBuffer | Uint8Array | Blob

export interface ViewerOptions {
  width?: number
  /** Scaling mode. contain = fit container width, none = use intrinsic slide size. */
  fitMode?: FitMode
  /** Initial zoom percentage. Effective scale = fitScale * zoomPercent/100. */
  zoomPercent?: number
  /**
   * Scroll container element used as IntersectionObserver root in list mode
   * (both windowed mounting and scroll-based slide tracking).
   * When omitted, the viewport (null root) is used.
   */
  scrollContainer?: HTMLElement
  /** Optional ZIP parsing limits for controlling resource usage and DoS surface. */
  zipLimits?: ZipParseLimits
  onSlideChange?: (index: number) => void
  onSlideRendered?: (index: number, element: HTMLElement) => void
  onSlideError?: (index: number, error: unknown) => void
  onSlideUnmounted?: (index: number) => void
  onNodeError?: (nodeId: string, error: unknown) => void
  onRenderStart?: () => void
  onRenderComplete?: () => void
}

export interface ListRenderOptions {
  windowed?: boolean
  batchSize?: number
  initialSlides?: number
  overscanViewport?: number
  /** Show "Slide N" labels below each slide. Default `false`. */
  showSlideLabels?: boolean
}

export interface PptxViewerEventMap {
  renderstart: Event
  rendercomplete: Event
  slidechange: CustomEvent<{ index: number }>
  sliderendered: CustomEvent<{ index: number; element: HTMLElement }>
  slideerror: CustomEvent<{ index: number; error: unknown }>
  slideunmounted: CustomEvent<{ index: number }>
  nodeerror: CustomEvent<{ nodeId: string; error: unknown }>
}

export class PptxViewer extends EventTarget {
  protected container: HTMLElement
  private viewerOptions: ViewerOptions
  private presentation: PresentationData | null = null
  private mediaUrlCache = new Map<string, string>()
  private chartInstances = new Set<ECharts>()
  private currentSlide = 0
  private _fitMode: FitMode
  private _isRendering = false
  private zoomFactor = 1
  private renderChain: Promise<void> = Promise.resolve()
  private cleanupListMount?: () => void
  private cleanupScrollObserver?: () => void
  private suppressScrollChange = false
  private ensureListSlideMountedFn?: (index: number) => void
  private resizeObserver?: ResizeObserver
  private windowResizeHandler?: () => void
  private resizeRafId: number | null = null
  private lastMeasuredContainerWidth = 0
  private mountedSlides = new Set<number>()
  private slideHandles = new Map<number, SlideHandle>()
  private activeRenderMode: 'list' | 'slide' | null = null
  private listOptions: Required<ListRenderOptions> = {
    windowed: false,
    batchSize: 12,
    initialSlides: 4,
    overscanViewport: 1.5,
    showSlideLabels: false,
  }

  constructor(container: HTMLElement, options?: ViewerOptions) {
    super()
    this.container = container
    this.viewerOptions = options ?? {}
    const zoomPercent = this.normalizeZoomPercent(options?.zoomPercent ?? 100)
    this._fitMode = options?.fitMode ?? 'contain'
    this.zoomFactor = zoomPercent / 100

    // Register shorthand callbacks as event listeners
    if (options?.onSlideChange) {
      const cb = options.onSlideChange
      this.addEventListener('slidechange', ((e: CustomEvent) =>
        cb(e.detail.index)) as EventListener)
    }
    if (options?.onSlideRendered) {
      const cb = options.onSlideRendered
      this.addEventListener('sliderendered', ((e: CustomEvent) =>
        cb(e.detail.index, e.detail.element)) as EventListener)
    }
    if (options?.onSlideError) {
      const cb = options.onSlideError
      this.addEventListener('slideerror', ((e: CustomEvent) =>
        cb(e.detail.index, e.detail.error)) as EventListener)
    }
    if (options?.onSlideUnmounted) {
      const cb = options.onSlideUnmounted
      this.addEventListener('slideunmounted', ((e: CustomEvent) =>
        cb(e.detail.index)) as EventListener)
    }
    if (options?.onNodeError) {
      const cb = options.onNodeError
      this.addEventListener('nodeerror', ((e: CustomEvent) =>
        cb(e.detail.nodeId, e.detail.error)) as EventListener)
    }
    if (options?.onRenderStart) {
      const cb = options.onRenderStart
      this.addEventListener('renderstart', () => cb())
    }
    if (options?.onRenderComplete) {
      const cb = options.onRenderComplete
      this.addEventListener('rendercomplete', () => cb())
    }
  }

  // -----------------------------------------------------------------------
  // Event dispatch helpers
  // -----------------------------------------------------------------------

  private emitRenderStart(): void {
    this._isRendering = true
    this.dispatchEvent(new Event('renderstart'))
  }

  private emitRenderComplete(): void {
    this._isRendering = false
    this.dispatchEvent(new Event('rendercomplete'))
  }

  private emitSlideChange(index: number): void {
    this.dispatchEvent(new CustomEvent('slidechange', { detail: { index } }))
  }

  private emitSlideRendered(index: number, element: HTMLElement): void {
    this.dispatchEvent(new CustomEvent('sliderendered', { detail: { index, element } }))
  }

  private emitSlideError(index: number, error: unknown): void {
    this.dispatchEvent(new CustomEvent('slideerror', { detail: { index, error } }))
  }

  private emitSlideUnmounted(index: number): void {
    this.dispatchEvent(new CustomEvent('slideunmounted', { detail: { index } }))
  }

  private emitNodeError(nodeId: string, error: unknown): void {
    this.dispatchEvent(new CustomEvent('nodeerror', { detail: { nodeId, error } }))
  }

  // -----------------------------------------------------------------------
  // Public: load / render modes
  // -----------------------------------------------------------------------

  /**
   * Load a parsed presentation model. Does NOT render — call `renderList()` or
   * `renderSlide()` afterwards.
   */
  load(presentation: PresentationData): void {
    this.presentation = presentation
    this.setupAdaptiveResize()
  }

  /**
   * Render all slides in a scrollable list.
   */
  async renderList(options?: ListRenderOptions): Promise<void> {
    this.activeRenderMode = 'list'
    this.listOptions = {
      windowed: options?.windowed ?? false,
      batchSize: this.normalizeBatchSize(options?.batchSize ?? 12),
      initialSlides: this.normalizePositiveInt(options?.initialSlides ?? 4, 4),
      overscanViewport: this.normalizePositiveFloat(options?.overscanViewport ?? 1.5, 1.5),
      showSlideLabels: options?.showSlideLabels ?? false,
    }
    await this.queueRender()
  }

  /**
   * Render a single slide (no built-in nav UI).
   */
  async renderSlide(index?: number): Promise<void> {
    this.activeRenderMode = 'slide'
    if (index !== undefined && this.presentation) {
      this.currentSlide = Math.max(0, Math.min(index, this.presentation.slides.length - 1))
    }
    await this.queueRender()
  }

  // -----------------------------------------------------------------------
  // Instance open
  // -----------------------------------------------------------------------

  async open(
    input: PreviewInput,
    options?: {
      renderMode?: 'list' | 'slide'
      listOptions?: ListRenderOptions
      signal?: AbortSignal
    }
  ): Promise<void> {
    const signal = options?.signal
    const checkAborted = () => {
      if (signal?.aborted) {
        throw new DOMException('Preview aborted', 'AbortError')
      }
    }

    checkAborted()

    // Clean up previous state
    this.destroy()

    const buffer = await normalizePreviewInput(input)
    checkAborted()

    const files = await parseZip(buffer, this.viewerOptions.zipLimits)
    checkAborted()

    const presentation = buildPresentation(files)
    checkAborted()

    this.load(presentation)

    const renderMode = options?.renderMode ?? 'list'
    if (renderMode === 'slide') {
      await this.renderSlide(0)
    } else {
      await this.renderList(options?.listOptions)
    }

    checkAborted()
  }

  // -----------------------------------------------------------------------
  // Static factory
  // -----------------------------------------------------------------------

  static async open(
    input: PreviewInput,
    container: HTMLElement,
    options?: ViewerOptions & {
      renderMode?: 'list' | 'slide'
      listOptions?: ListRenderOptions
      signal?: AbortSignal
    }
  ): Promise<PptxViewer> {
    const viewer = new PptxViewer(container, options)
    await viewer.open(input, {
      renderMode: options?.renderMode,
      listOptions: options?.listOptions,
      signal: options?.signal,
    })
    return viewer
  }

  // -----------------------------------------------------------------------
  // Navigation
  // -----------------------------------------------------------------------

  async goToSlide(index: number, scrollOptions?: ScrollIntoViewOptions): Promise<void> {
    if (!this.presentation) return
    const prev = this.currentSlide
    this.currentSlide = Math.max(0, Math.min(index, this.presentation.slides.length - 1))
    if (this.currentSlide !== prev) {
      this.emitSlideChange(this.currentSlide)
    }
    if (this.activeRenderMode === 'slide') {
      const { scale, displayWidth, displayHeight } = this.getDisplayMetrics()
      this.renderSingleSlide(scale, displayWidth, displayHeight)
    } else {
      this.suppressScrollChange = true
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          this.suppressScrollChange = false
          resolve()
        })
      )
      this.ensureListSlideMountedFn?.(this.currentSlide)
      const targetChild = this.container.querySelector<HTMLElement>(
        `[data-slide-index="${this.currentSlide}"]`
      )
      if (targetChild) {
        targetChild.scrollIntoView(scrollOptions ?? { behavior: 'smooth', block: 'center' })
      }
    }
  }

  async setZoom(percent: number): Promise<void> {
    const normalized = this.normalizeZoomPercent(percent)
    const nextFactor = normalized / 100
    if (nextFactor === this.zoomFactor) return
    this.zoomFactor = nextFactor
    await this.queueRender()
  }

  async setFitMode(mode: FitMode): Promise<void> {
    if (this._fitMode === mode) return
    this._fitMode = mode
    if (mode === 'none') {
      this.lastMeasuredContainerWidth = 0
    }
    await this.queueRender()
  }

  // -----------------------------------------------------------------------
  // Getters
  // -----------------------------------------------------------------------

  get presentationData(): PresentationData | null {
    return this.presentation
  }

  get slideCount(): number {
    return this.presentation?.slides.length ?? 0
  }

  get slideWidth(): number {
    return this.presentation?.width ?? 0
  }

  get slideHeight(): number {
    return this.presentation?.height ?? 0
  }

  get currentSlideIndex(): number {
    return this.currentSlide
  }

  get isRendering(): boolean {
    return this._isRendering
  }

  get zoomPercent(): number {
    return this.zoomFactor * 100
  }

  get fitMode(): FitMode {
    return this._fitMode
  }

  // -----------------------------------------------------------------------
  // Typed event helpers
  // -----------------------------------------------------------------------

  on<K extends keyof PptxViewerEventMap>(
    type: K,
    listener: (event: PptxViewerEventMap[K]) => void
  ): this {
    this.addEventListener(type, listener as EventListener)
    return this
  }

  off<K extends keyof PptxViewerEventMap>(
    type: K,
    listener: (event: PptxViewerEventMap[K]) => void
  ): this {
    this.removeEventListener(type, listener as EventListener)
    return this
  }

  isSlideMounted(index: number): boolean {
    return this.mountedSlides.has(index)
  }

  getMountedSlides(): number[] {
    return [...this.mountedSlides].sort((a, b) => a - b)
  }

  // -----------------------------------------------------------------------
  // External slide rendering
  // -----------------------------------------------------------------------

  /**
   * Render a single slide into an external container element.
   * Useful for React/Vue integration, thumbnail generation, etc.
   *
   * **Ownership:** The caller owns the returned {@link SlideHandle} and is
   * responsible for calling `handle.dispose()` when the slide is no longer
   * needed. `destroy()` does NOT automatically dispose externally-rendered
   * handles.
   */
  renderSlideToContainer(
    index: number,
    container: HTMLElement,
    scale?: number
  ): SlideHandle | null {
    if (!this.presentation) return null
    const slide = this.presentation.slides[index]
    if (!slide) return null

    const handle = renderSlideInternal(this.presentation, slide, {
      onNodeError: (nodeId, error) => this.emitNodeError(nodeId, error),
      onNavigate: (target) => this.handleNavigate(target),
      mediaUrlCache: this.mediaUrlCache,
      chartInstances: this.chartInstances,
    })

    if (scale !== undefined && scale !== 1) {
      handle.element.style.transform = `scale(${scale})`
      handle.element.style.transformOrigin = 'top left'
    }

    container.appendChild(handle.element)
    this.emitSlideRendered(index, handle.element)
    return handle
  }

  /**
   * Hook called after rendering a single slide. Override in subclasses to
   * append additional UI (e.g. navigation buttons).
   */
  protected afterSingleSlideRender(): void {
    // No-op in base class
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  destroy(): void {
    this.teardownAdaptiveResize()
    this.cleanupScrollObserver?.()
    this.cleanupScrollObserver = undefined
    this.cleanupListMount?.()
    this.cleanupListMount = undefined
    this.ensureListSlideMountedFn = undefined
    this.mountedSlides.clear()
    for (const handle of this.slideHandles.values()) {
      handle.dispose()
    }
    this.slideHandles.clear()
    this.disposeAllCharts()
    for (const url of this.mediaUrlCache.values()) {
      URL.revokeObjectURL(url)
    }
    this.mediaUrlCache.clear()
    this.container.innerHTML = ''
    this.presentation = null
    this.activeRenderMode = null
  }

  [Symbol.dispose](): void {
    this.destroy()
  }

  // -----------------------------------------------------------------------
  // Internal: rendering pipeline
  // -----------------------------------------------------------------------

  private normalizeZoomPercent(percent: number): number {
    if (!Number.isFinite(percent)) return 100
    return Math.max(10, Math.min(400, percent))
  }

  private normalizeBatchSize(val: number): number {
    return Number.isInteger(val) && val > 0 ? val : 12
  }

  private normalizePositiveInt(val: number, fallback: number): number {
    return Number.isInteger(val) && val > 0 ? val : fallback
  }

  private normalizePositiveFloat(val: number, fallback: number): number {
    return Number.isFinite(val) && val > 0 ? val : fallback
  }

  private getDisplayMetrics(): { scale: number; displayWidth: number; displayHeight: number } {
    if (!this.presentation) {
      return { scale: 1, displayWidth: 0, displayHeight: 0 }
    }
    const fitWidth = this.viewerOptions.width ?? (this.container.clientWidth || 960)
    if (this._fitMode === 'contain' && this.viewerOptions.width === undefined) {
      this.lastMeasuredContainerWidth = fitWidth
    }
    const fitScale = this._fitMode === 'contain' ? fitWidth / this.presentation.width : 1
    const scale = fitScale * this.zoomFactor
    return {
      scale,
      displayWidth: this.presentation.width * scale,
      displayHeight: this.presentation.height * scale,
    }
  }

  private async queueRender(): Promise<void> {
    this.renderChain = this.renderChain.then(async () => {
      if (!this.presentation) return
      this.emitRenderStart()
      try {
        const { scale, displayWidth, displayHeight } = this.getDisplayMetrics()

        this.cleanupScrollObserver?.()
        this.cleanupScrollObserver = undefined
        this.cleanupListMount?.()
        this.cleanupListMount = undefined
        this.ensureListSlideMountedFn = undefined
        this.mountedSlides.clear()
        for (const handle of this.slideHandles.values()) {
          handle.dispose()
        }
        this.slideHandles.clear()
        this.disposeAllCharts()
        this.container.innerHTML = ''
        this.container.style.position = 'relative'

        if (this.activeRenderMode === 'slide') {
          this.renderSingleSlide(scale, displayWidth, displayHeight)
        } else if (this.listOptions.windowed) {
          await this.renderAllSlidesWindowed(scale, displayWidth, displayHeight)
        } else {
          await this.renderAllSlidesFull(scale, displayWidth, displayHeight)
        }

        // Post-render width correction: appending slides may cause a scrollbar
        // to appear on the page, narrowing the container. If the measured width
        // changed, patch wrapper sizes and scale transforms in-place so content
        // is not clipped by the (now narrower) container.
        if (this.activeRenderMode !== 'slide') {
          this.correctListMetricsIfNeeded()
        }

        this.emitSlideChange(this.currentSlide)
      } finally {
        this.emitRenderComplete()
      }
    })
    return this.renderChain
  }

  private handleContainerResize(): void {
    if (!this.presentation) return
    if (this._fitMode !== 'contain') return
    if (this.viewerOptions.width !== undefined) return

    const nextWidth = this.container.clientWidth || 0
    if (!nextWidth || nextWidth === this.lastMeasuredContainerWidth) return
    this.lastMeasuredContainerWidth = nextWidth

    if (this.resizeRafId !== null) {
      cancelAnimationFrame(this.resizeRafId)
    }
    this.resizeRafId = requestAnimationFrame(() => {
      this.resizeRafId = null
      void this.queueRender()
    })
  }

  private setupAdaptiveResize(): void {
    this.teardownAdaptiveResize()

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.handleContainerResize())
      observer.observe(this.container)
      this.resizeObserver = observer
      return
    }

    this.windowResizeHandler = () => this.handleContainerResize()
    window.addEventListener('resize', this.windowResizeHandler)
  }

  private teardownAdaptiveResize(): void {
    this.resizeObserver?.disconnect()
    this.resizeObserver = undefined
    if (this.windowResizeHandler) {
      window.removeEventListener('resize', this.windowResizeHandler)
      this.windowResizeHandler = undefined
    }
    if (this.resizeRafId !== null) {
      cancelAnimationFrame(this.resizeRafId)
      this.resizeRafId = null
    }
  }

  private disposeAllCharts(): void {
    for (const chart of this.chartInstances) {
      if (!chart.isDisposed()) {
        chart.dispose()
      }
    }
    this.chartInstances.clear()
  }

  private createListSlideItem(
    index: number,
    displayWidth: number,
    displayHeight: number
  ): { item: HTMLDivElement; wrapper: HTMLDivElement } {
    const item = document.createElement('div')
    item.dataset.slideIndex = String(index)
    item.style.cssText = 'width: fit-content; margin: 0 auto 20px;'

    const wrapper = document.createElement('div')
    wrapper.style.cssText = `
      width: ${displayWidth}px;
      height: ${displayHeight}px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      overflow: hidden;
      position: relative;
      background: #fff;
    `

    item.appendChild(wrapper)

    if (this.listOptions.showSlideLabels) {
      const label = document.createElement('div')
      label.style.cssText = 'text-align: center; padding: 4px; font-size: 12px; color: #666;'
      label.textContent = `Slide ${index + 1}`
      item.appendChild(label)
    }
    return { item, wrapper }
  }

  private mountListSlide(
    index: number,
    wrapper: HTMLDivElement,
    scale: number,
    _displayWidth: number,
    _displayHeight: number
  ): void {
    if (!this.presentation) return
    if (wrapper.dataset.mounted === '1') return
    wrapper.dataset.mounted = '1'
    wrapper.innerHTML = ''
    this.mountedSlides.add(index)

    const slide = this.presentation.slides[index]
    try {
      const handle = renderSlideInternal(this.presentation, slide, {
        onNodeError: (nodeId, error) => this.emitNodeError(nodeId, error),
        onNavigate: (target) => this.handleNavigate(target),
        mediaUrlCache: this.mediaUrlCache,
        chartInstances: this.chartInstances,
      })

      this.slideHandles.set(index, handle)
      handle.element.style.transform = `scale(${scale})`
      handle.element.style.transformOrigin = 'top left'
      wrapper.appendChild(handle.element)
      this.emitSlideRendered(index, handle.element)
    } catch (e) {
      this.emitSlideError(index, e)
      wrapper.style.background = '#fff3f3'
      wrapper.style.display = 'flex'
      wrapper.style.alignItems = 'center'
      wrapper.style.justifyContent = 'center'
      wrapper.style.border = '2px dashed #ff6b6b'
      wrapper.style.color = '#cc0000'
      wrapper.style.fontSize = '14px'
      wrapper.textContent = `Slide ${index + 1}: Render Error - ${e instanceof Error ? e.message : String(e)}`
    }
  }

  private unmountListSlide(index: number, wrapper: HTMLDivElement, displayHeight: number): void {
    if (wrapper.dataset.mounted !== '1') return
    wrapper.dataset.mounted = '0'
    this.mountedSlides.delete(index)
    const handle = this.slideHandles.get(index)
    if (handle) {
      handle.dispose()
      this.slideHandles.delete(index)
    }
    wrapper.innerHTML = ''
    wrapper.style.background = '#fff'
    wrapper.style.display = ''
    wrapper.style.alignItems = ''
    wrapper.style.justifyContent = ''
    wrapper.style.border = ''
    wrapper.style.color = ''
    wrapper.style.fontSize = ''
    wrapper.style.height = `${displayHeight}px`
    this.emitSlideUnmounted(index)
  }

  private async renderAllSlidesFull(
    scale: number,
    displayWidth: number,
    displayHeight: number
  ): Promise<void> {
    if (!this.presentation) return
    const batchSize = this.listOptions.batchSize
    let batchFragment = document.createDocumentFragment()

    for (let i = 0; i < this.presentation.slides.length; i++) {
      const { item, wrapper } = this.createListSlideItem(i, displayWidth, displayHeight)
      this.mountListSlide(i, wrapper, scale, displayWidth, displayHeight)
      batchFragment.appendChild(item)

      if ((i + 1) % batchSize === 0) {
        this.container.appendChild(batchFragment)
        batchFragment = document.createDocumentFragment()
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }
    }

    if (batchFragment.childNodes.length > 0) {
      this.container.appendChild(batchFragment)
    }

    this.setupScrollSlideTracking()
  }

  private async renderAllSlidesWindowed(
    scale: number,
    displayWidth: number,
    displayHeight: number
  ): Promise<void> {
    if (!this.presentation) return
    const batchSize = this.listOptions.batchSize
    let batchFragment = document.createDocumentFragment()
    const wrappers: HTMLDivElement[] = []

    for (let i = 0; i < this.presentation.slides.length; i++) {
      const { item, wrapper } = this.createListSlideItem(i, displayWidth, displayHeight)
      wrappers.push(wrapper)
      batchFragment.appendChild(item)

      if ((i + 1) % batchSize === 0) {
        this.container.appendChild(batchFragment)
        batchFragment = document.createDocumentFragment()
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }
    }

    if (batchFragment.childNodes.length > 0) {
      this.container.appendChild(batchFragment)
    }

    const mount = (idx: number): void => {
      if (idx < 0 || idx >= wrappers.length) return
      this.mountListSlide(idx, wrappers[idx], scale, displayWidth, displayHeight)
    }
    const unmount = (idx: number): void => {
      if (idx < 0 || idx >= wrappers.length) return
      this.unmountListSlide(idx, wrappers[idx], displayHeight)
    }

    const initial = this.listOptions.initialSlides
    for (let i = 0; i < Math.min(initial, wrappers.length); i++) mount(i)
    this.ensureListSlideMountedFn = mount

    const IO = window.IntersectionObserver
    if (!IO) {
      for (let i = initial; i < wrappers.length; i++) mount(i)
      this.setupScrollSlideTracking()
      return
    }

    const ioRoot = this.viewerOptions.scrollContainer ?? null
    const overscanViewport = this.listOptions.overscanViewport
    const rootHeight = ioRoot ? ioRoot.clientHeight : window.innerHeight
    const rootMargin = `${Math.round(rootHeight * overscanViewport)}px 0px`
    const observer = new IO(
      (entries) => {
        for (const entry of entries) {
          const item = (entry.target as HTMLElement).parentElement
          const index = Number(item?.dataset.slideIndex ?? '-1')
          if (Number.isNaN(index) || index < 0) continue
          if (entry.isIntersecting) {
            mount(index)
          } else {
            unmount(index)
          }
        }
      },
      { root: ioRoot, rootMargin, threshold: 0 }
    )

    wrappers.forEach((wrapper) => {
      observer.observe(wrapper)
    })

    this.cleanupListMount = () => {
      observer.disconnect()
      this.ensureListSlideMountedFn = undefined
    }

    this.setupScrollSlideTracking()
  }

  private setupScrollSlideTracking(): void {
    if (this.activeRenderMode === 'slide') return

    const IO = window.IntersectionObserver
    if (!IO) return

    const items = this.container.querySelectorAll<HTMLElement>('[data-slide-index]')
    if (!items.length) return

    const ratios = new Map<number, number>()
    const ioRoot = this.viewerOptions.scrollContainer ?? null

    const observer = new IO(
      (entries) => {
        for (const entry of entries) {
          const idx = Number((entry.target as HTMLElement).dataset.slideIndex ?? '-1')
          if (Number.isNaN(idx) || idx < 0) continue
          ratios.set(idx, entry.intersectionRatio)
        }

        if (this.suppressScrollChange) return

        let bestIdx = -1
        let bestRatio = -1
        for (const [idx, ratio] of ratios) {
          if (ratio > bestRatio) {
            bestRatio = ratio
            bestIdx = idx
          }
        }

        if (bestIdx >= 0 && bestIdx !== this.currentSlide) {
          this.currentSlide = bestIdx
          this.emitSlideChange(bestIdx)
        }
      },
      { root: ioRoot, threshold: [0, 0.25, 0.5, 0.75, 1.0] }
    )

    items.forEach((item) => observer.observe(item))

    this.cleanupScrollObserver = () => {
      observer.disconnect()
    }
  }

  private renderSingleSlide(scale: number, displayWidth: number, displayHeight: number): void {
    if (!this.presentation) return

    const slide = this.presentation.slides[this.currentSlide]
    if (!slide) return

    for (const handle of this.slideHandles.values()) {
      handle.dispose()
    }
    this.slideHandles.clear()
    this.disposeAllCharts()
    this.container.innerHTML = ''
    this.mountedSlides.clear()
    this.mountedSlides.add(this.currentSlide)

    const wrapper = document.createElement('div')
    wrapper.style.cssText = `
      width: ${displayWidth}px; height: ${displayHeight}px;
      margin: 0 auto; overflow: hidden; position: relative;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    `

    try {
      const handle = renderSlideInternal(this.presentation, slide, {
        onNodeError: (nodeId, error) => this.emitNodeError(nodeId, error),
        onNavigate: (target) => this.handleNavigate(target),
        mediaUrlCache: this.mediaUrlCache,
        chartInstances: this.chartInstances,
      })
      this.slideHandles.set(this.currentSlide, handle)
      handle.element.style.transform = `scale(${scale})`
      handle.element.style.transformOrigin = 'top left'
      wrapper.appendChild(handle.element)
      this.emitSlideRendered(this.currentSlide, handle.element)
    } catch (e) {
      this.emitSlideError(this.currentSlide, e)
      wrapper.style.background = '#fff3f3'
      wrapper.style.display = 'flex'
      wrapper.style.alignItems = 'center'
      wrapper.style.justifyContent = 'center'
      wrapper.style.border = '2px dashed #ff6b6b'
      wrapper.style.color = '#cc0000'
      wrapper.style.fontSize = '14px'
      wrapper.textContent = `Slide ${this.currentSlide + 1}: Render Error - ${e instanceof Error ? e.message : String(e)}`
    }

    this.container.appendChild(wrapper)
    this.afterSingleSlideRender()
  }

  /**
   * After list-mode rendering, a scrollbar may appear on the page body
   * (or a scroll ancestor), narrowing the container. If the container's
   * clientWidth now differs from the width used to compute the initial
   * scale, patch every wrapper's dimensions and each slide element's
   * transform in-place — no DOM rebuild required.
   */
  private correctListMetricsIfNeeded(): void {
    if (!this.presentation) return
    if (this._fitMode !== 'contain') return
    if (this.viewerOptions.width !== undefined) return

    const currentWidth = this.container.clientWidth || 0
    if (!currentWidth || currentWidth === this.lastMeasuredContainerWidth) return

    // Width changed — recompute metrics
    this.lastMeasuredContainerWidth = currentWidth
    const fitScale = currentWidth / this.presentation.width
    const newScale = fitScale * this.zoomFactor
    const newDisplayW = this.presentation.width * newScale
    const newDisplayH = this.presentation.height * newScale

    // Patch every slide wrapper in the list
    const items = this.container.querySelectorAll<HTMLElement>('[data-slide-index]')
    for (const item of items) {
      const wrapper = item.firstElementChild as HTMLElement | null
      if (!wrapper) continue
      wrapper.style.width = `${newDisplayW}px`
      wrapper.style.height = `${newDisplayH}px`
      // The slide element is the first child of the wrapper
      const slideEl = wrapper.firstElementChild as HTMLElement | null
      if (slideEl) {
        slideEl.style.transform = `scale(${newScale})`
      }
    }
  }

  private handleNavigate(target: { slideIndex?: number; url?: string }): void {
    if (target.slideIndex !== undefined) {
      this.goToSlide(target.slideIndex)
    } else if (target.url && isAllowedExternalUrl(target.url)) {
      window.open(target.url, '_blank', 'noopener,noreferrer')
    }
  }
}

// -----------------------------------------------------------------------
// Standalone helper (shared with Renderer.ts)
// -----------------------------------------------------------------------

export async function normalizePreviewInput(input: PreviewInput): Promise<ArrayBuffer> {
  if (input instanceof ArrayBuffer) return input
  if (input instanceof Uint8Array) {
    const bytes = new Uint8Array(input.byteLength)
    bytes.set(input)
    return bytes.buffer
  }

  const blobLike = input as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> }
  if (typeof blobLike.arrayBuffer === 'function') {
    return blobLike.arrayBuffer()
  }

  if (typeof FileReader !== 'undefined') {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read Blob input'))
      reader.readAsArrayBuffer(blobLike)
    })
  }

  if (typeof Response !== 'undefined') {
    return new Response(blobLike).arrayBuffer()
  }

  throw new Error('Blob preview input is not supported in this runtime')
}
