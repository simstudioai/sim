import type { ToolResponse } from '@/tools/types'

export type LatexCompiler = 'pdflatex' | 'xelatex' | 'lualatex' | 'platex' | 'uplatex' | 'context'

/**
 * Supporting file made available to the compiler alongside the main document.
 * Exactly one of `content` (plain text), `file` (base64), or `url` (remote
 * file) must be provided.
 */
export interface LatexResource {
  path: string
  content?: string
  file?: string
  url?: string
}

export interface LatexCompileParams {
  content: string
  compiler?: LatexCompiler
  fileName?: string
  resources?: LatexResource[]
}

export interface LatexCompileResponse extends ToolResponse {
  output: {
    pdf: unknown
    pdfUrl: string
    fileName: string
    compiler: string
  }
}
