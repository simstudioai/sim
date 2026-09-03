import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * v3 of tailwind-merge, matching the app's Tailwind v4 utility surface. v2
 * encodes Tailwind v3's smaller set and would stop resolving conflicts for
 * anything v4 added or renamed.
 *
 * The `font-size` extension teaches the merger that Sim's own type scale keys
 * are font sizes, not colours — without it `text-small` and `text-sm` do not
 * conflict, so a component that sets one while a consumer passes the other
 * emits both and CSS source order decides instead of the caller.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['micro', 'caption', 'small', 'md'] }],
    },
  },
})

/** Combines class names and resolves Tailwind conflicts, last argument winning. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
