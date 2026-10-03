'use client'

import { Code, chipFieldSurfaceClass, cn } from '@sim/emcn'

interface CodeBlockProps {
  code: string
  language: 'javascript' | 'json' | 'python' | 'bash'
}

/**
 * Blog code block. Renders through emcn's read-only `Code.Viewer` on the same `chipFieldSurfaceClass`
 * surface as the in-app custom-tools `CodeEditor`, so a fenced block in a post matches the real editor
 * (Prism theme, gutter, font) on a theme-following surface rather than a forced-dark one.
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
