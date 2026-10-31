import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'micro',
            'caption',
            'small',
            'md',
            'docs-title',
            'docs-h1',
            'docs-h2',
            'docs-h3',
            'docs-body',
            'docs-lead',
            'docs-nav',
            'docs-table',
            'docs-control',
            'docs-header',
            'docs-caption',
            'docs-code',
            'docs-keyboard',
          ],
        },
      ],
    },
  },
})

/** Extends Sim's class merging for docs typography without changing platform tokens. */
export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs))
}
