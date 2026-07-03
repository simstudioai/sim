export * from './components'
/**
 * `Calendar` exists in BOTH `./components` (the date picker) and `./icons` (a
 * glyph). Like `Table` above, this explicit re-export resolves the barrel to
 * the COMPONENT; the icon stays available from `@sim/emcn/icons`.
 */
export { Calendar, type CalendarProps } from './components/calendar/calendar'
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
export { useCopyToClipboard } from './hooks/use-copy-to-clipboard'
export * from './icons'
export { cn } from './lib/cn'
export { handleKeyboardActivation, isKeyboardActivation } from './lib/keyboard'
