export * from './components'
/**
 * `Calendar` exists in BOTH `./components` (the date picker) and `./icons` (a
 * glyph). Like `Table` above, this explicit re-export resolves the barrel to
 * the COMPONENT; the icon stays available from `@sim/emcn/icons`.
 */
export { Calendar, type CalendarProps } from './components/calendar/calendar'
/**
 * `Code` exists in BOTH `./components` (the code editor) and `./icons` (a
 * glyph). Same resolution as `Calendar` and `Table`: the barrel yields the
 * COMPONENT, and the icon stays available from `@sim/emcn/icons`.
 */
export {
  CODE_LINE_HEIGHT_PX,
  Code,
  calculateGutterWidth,
  getCodeEditorProps,
} from './components/code/code'
export {
  SCROLL_FADE_BAND_PX,
  type ScrollEdges,
  type ScrollEdgesX,
  scrollFadeAttributes,
  scrollFadeClass,
  scrollFadeXClass,
} from './components/scroll-fade/scroll-fade'
/**
 * `Table` exists in BOTH `./components` (data-table element) and `./icons`
 * (glyph). This explicit re-export resolves the ambiguity to the COMPONENT —
 * always import the icon from `@sim/emcn/icons`. Rendering the
 * component as an icon paints an empty `w-full` table that squeezes its
 * siblings (shipped as the tables-header "T…" flicker).
 */
export {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from './components/table/table'
export {
  type ClipboardContent,
  useCopyToClipboard,
  writeTextToClipboard,
} from './hooks/use-copy-to-clipboard'
export { usePrefersReducedMotion } from './hooks/use-prefers-reduced-motion'
export { useScrollEdges } from './hooks/use-scroll-edges'
export * from './icons'
export { cn } from './lib/cn'
export { handleKeyboardActivation, isKeyboardActivation } from './lib/keyboard'
