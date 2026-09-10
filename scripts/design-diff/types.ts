export type Data = null | boolean | number | string | Data[] | { [key: string]: Data }
export type Decision = 'flag' | 'review' | 'exempt'
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
export interface Finding {
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
export interface Config {
  sourceRoots: string[]
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
  renderingDependencies: string
  limits: {
    fileBytes: number
    totalBytes: number
    resolutionDepth: number
    resolutionSteps: number
  }
}
export interface Report {
  schemaVersion: '1.0.0'
  engineVersion: '0.1.0'
  policyVersion: '1.0.0'
  commits: { base: string; head: string; mergeBase: string } | null
  status: 'completed' | 'failed'
  flagged: boolean | null
  findings: Finding[]
  limitations: string[]
  error?: string
  context?: { pullRequest: number; headSha: string; engineSha: string }
}
