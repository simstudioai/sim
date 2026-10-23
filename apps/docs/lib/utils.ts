/**
 * Re-exported from the design system rather than built here, so docs runs one
 * merge engine instead of two: its own components already import `cn` from
 * `@sim/emcn` indirectly, and a second `cn` entry point would ship a duplicate
 * engine and lookup tables.
 *
 * It also carries emcn's `font-size` class group, which docs needs — its
 * `global.css` defines the same `--text-micro/caption/small/md` scale, and the
 * stock merger does not treat those as font sizes, so `cn('text-small',
 * 'text-sm')` emitted both and let CSS source order pick the winner.
 */
export { cn } from '@sim/emcn'
