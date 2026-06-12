import type { UserFile } from '@/executor/types'
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

/**
 * Reference to the compiled PDF when no execution-file context is available;
 * with execution context the output is a full {@link UserFile}.
 */
export interface LatexPdfReference {
  name: string
  url: string
  mimeType: string
}

export interface LatexCompileResponse extends ToolResponse {
  output: {
    pdf: UserFile | LatexPdfReference | ''
    pdfUrl: string
    fileName: string
    compiler: string
  }
}

export interface LatexSearchPackagesParams {
  query: string
  maxResults?: number
}

export interface LatexPackageSummary {
  name: string
  shortDescription: string | null
  installed: boolean
  ctanUrl: string | null
}

export interface LatexSearchPackagesResponse extends ToolResponse {
  output: {
    packages: LatexPackageSummary[]
    totalMatches: number
  }
}

export interface LatexGetPackageParams {
  name: string
}

export interface LatexGetPackageResponse extends ToolResponse {
  output: {
    package: {
      name: string
      installed: boolean
      shortDescription: string | null
      longDescription: string | null
      category: string | null
      license: string | null
      topics: string[]
      relatedPackages: string[]
      homepage: string | null
      ctanUrl: string | null
    }
  }
}

export interface LatexListFontsParams {
  query?: string
  maxResults?: number
}

export interface LatexFont {
  family: string
  name: string
  styles: string[]
}

export interface LatexListFontsResponse extends ToolResponse {
  output: {
    fonts: LatexFont[]
    totalMatches: number
  }
}

export type LatexResponse =
  | LatexCompileResponse
  | LatexSearchPackagesResponse
  | LatexGetPackageResponse
  | LatexListFontsResponse
