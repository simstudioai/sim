/**
 * Internal PPTX source ported from https://github.com/aiden0z/pptx-renderer and
 * adapted for use in Sim.
 */
export type {
  FitMode,
  ListRenderOptions,
  PptxViewerEventMap,
  PreviewInput,
  ViewerOptions,
} from './core/viewer'
export { PptxViewer } from './core/viewer'
export type { PresentationData } from './model/presentation'
export { buildPresentation } from './model/presentation'
export type { PptxFiles, ZipParseLimits } from './parser/zip-parser'
export { parseZip } from './parser/zip-parser'
export type { SlideHandle, SlideRendererOptions } from './renderer/slide-renderer'
export { renderSlide } from './renderer/slide-renderer'
