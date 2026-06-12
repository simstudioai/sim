export * from './components'
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
// Both ./components (tooltip affordance) and ./icons (glyph) export `Info`;
// the barrel resolves to the component — import the glyph from
// '@/components/emcn/icons' directly.
export { Info } from './components/info/info'
