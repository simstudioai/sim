export * from './components'
/**
 * `Table` exists in BOTH `./components` (data-table element) and `./icons`
 * (glyph). This explicit re-export resolves the ambiguity to the COMPONENT —
 * always import the icon from `@/components/emcn/icons`. Rendering the
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
export * from './icons'
