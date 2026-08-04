'use client'

import { Code, chipFieldSurfaceClass, cn } from '@sim/emcn'

interface CodeBlockProps {
  code: string
  language: 'javascript' | 'json' | 'python'
}

/**
 * Blog code block. Renders through emcn's read-only `Code.Viewer` wearing the exact same
 * `chipFieldSurfaceClass` surface the in-app code editor uses (the custom-tools `CodeEditor`),
 * so a fenced block in a post matches the real editor: same Prism theme, gutter, and font, on
 * the same theme-following surface (`--surface-5`/`--border-1`, rounded-lg) — no forced dark,
 * all from existing design tokens.
 */
export function CodeBlock({ code, language }: CodeBlockProps) {
  return (
    <Code.Viewer
      code={code}
      showGutter
      language={language}
      className={cn(chipFieldSurfaceClass, 'w-full overflow-hidden text-sm')}
    />
  )
}
