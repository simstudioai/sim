export type Data = null | boolean | number | string | Data[] | { [key: string]: Data }
export type Decision = 'flag' | 'exempt'
export type Category =
  | 'colour'
  | 'dimensions'
  | 'typography'
  | 'shape-effects'
  | 'layout'
  | 'visibility'
  | 'content'
  | 'motion'
  | 'movement'
  | 'infrastructure'
  | 'unresolved'
  | 'nonvisual'

export interface Location {
  file: string
  line: number
  column: number
}
export interface Evidence {
  value: Data
  unresolved: string[]
  dependencies: string[]
}
export interface Definition extends Evidence {
  appearance?: { media?: boolean; shared?: boolean; element?: string }
  key: string
  kind:
    | 'class'
    | 'style'
    | 'markup'
    | 'content'
    | 'attribute'
    | 'css'
    | 'native'
    | 'asset'
    | 'review'
  property: string
  location: Location
  symbol: string
  conditions: Data[]
  movement?: { bounds: number[]; viewport: number[]; appearance: Data }
}
export interface Change {
  id: string
  decision: Decision
  category: Category
  reason: string
  before: { value: Data; location: Location; conditions: Data[]; property: string } | null
  after: { value: Data; location: Location; conditions: Data[]; property: string } | null
  symbol: string
  consumers: string[]
  dependencies: string[]
  limitations: string[]
}
export interface Finding extends Change {
  source: {
    before: { file: string; blob: string } | null
    after: { file: string; blob: string } | null
  }
  categories: Category[]
  changes: Change[]
  example: { basis: 'changed-definition' | 'potential-consumer'; change: Change } | null
  impact: {
    basis: 'resolved-static-references'
    before: UsageCount
    after: UsageCount
  }
}
export interface UsageCount {
  coverage: 'partial'
  referenceCount: number
  fileCount: number
  references: {
    location: Location
    symbol: string
    kind: 'jsx' | 'call' | 'reference'
  }[]
}
export interface Config {
  sourceRoots: string[]
  mediaModules?: string[]
  mediaSources?: string[]
  mediaSymbols?: { file: string; names: string[] }[]
  exclude: string[]
  renderedMarkdown: string[]
  aliases: { from: string; prefix: string; target: string }[]
  themes: { roots: string[]; path: string }[]
  classModules: string[]
  variantModules: string[]
  mergeFontSizes: string[]
  nativeRendering: string[]
  classFunctions: string[]
  variantFunctions: string[]
  nativeAppearance: string[]
  infrastructure: string[]
  documentationContent?: {
    components: { module: string; names: string[]; contentProps: string[] }[]
  }
  fileInputs?: {
    list: string
    export: string
    root: string
    renderer: string
    contentOnly?: boolean
  }[]
  environmentAdapters?: {
    module: string
    export: string
    environmentModule: string
    environmentExport: string
    implementationModule: string
    implementationExport: string
  }[]
  renderingDependencies: string
  limits: {
    fileBytes: number
    totalBytes: number
    resolutionDepth: number
    resolutionSteps: number
  }
}
export interface Report {
  schemaVersion: '3.0.0'
  engineVersion: '0.5.2'
  policyVersion: '5.0.0'
  commits: { base: string; head: string; mergeBase: string } | null
  status: 'completed' | 'failed'
  flagged: boolean | null
  findings: Finding[]
  limitations: string[]
  truncation?: {
    valuePreviewBytes: number
    reportLimitBytes: number
    findingsTotal: number
    omittedFindings: number
    lists: { path: string; total: number; omitted: number }[]
  }
  error?: string
  context?: { pullRequest: number; headSha: string; engineSha: string }
}
