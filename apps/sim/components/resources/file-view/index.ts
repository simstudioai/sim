/**
 * The file resource view. Consumers mount {@link FileView} against a source,
 * grants, and a host; everything else here is what the surrounding surfaces
 * (toolbars, tab chrome) need to describe a file without opening it.
 */

export { RICH_PREVIEWABLE_EXTENSIONS } from './components/preview-panel'
export type { FileViewStreaming, PreviewMode } from './file-view'
export {
  FileView,
  isCsvStreamOnly,
  isMarkdownFile,
  isPreviewable,
  isTextEditable,
} from './file-view'
export { resolveFileCategory } from './utils/file-category'
