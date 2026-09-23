export interface CodaResourceUri {
  uri: string
  docId: string
}

/** Coda's current MCP emits superhuman:// URIs; older grants may emit coda:// URIs. */
export function parseCodaResourceUri(value: string): CodaResourceUri | null {
  if (value.length > 1000) return null
  const uri = value.split('#', 1)[0] ?? ''
  if (!/^(?:coda|superhuman):\/\/docs\/[\w-]+(?:\/[\w-]+)*$/.test(uri)) return null
  return { uri, docId: uri.split('/')[3]! }
}
