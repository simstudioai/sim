/** Escapes one decoded folder name for the internal slash-delimited display path. */
export function encodeWorkspaceFileFolderDisplaySegment(name: string): string {
  if (name.length === 0) throw new Error('Workspace file folder names cannot be empty')
  return name.replaceAll('\\', '\\\\').replaceAll('/', '\\/')
}

/** Builds an internal display path where `\/` represents a slash inside a folder name. */
export function buildWorkspaceFileFolderDisplayPath(segments: readonly string[]): string {
  return segments.map(encodeWorkspaceFileFolderDisplaySegment).join('/')
}

/** Parses an internal display path without confusing an escaped slash for a path delimiter. */
export function parseWorkspaceFileFolderDisplayPath(path: string): string[] {
  if (path.length === 0) return []

  const segments: string[] = []
  let segment = ''

  for (let index = 0; index < path.length; index += 1) {
    const character = path[index]
    if (character === '/') {
      if (segment.length === 0) throw new Error('Workspace file folder path contains an empty name')
      segments.push(segment)
      segment = ''
      continue
    }
    if (character !== '\\') {
      segment += character
      continue
    }

    const escaped = path[index + 1]
    if (escaped !== '/' && escaped !== '\\') {
      throw new Error('Workspace file folder path contains an invalid escape')
    }
    segment += escaped
    index += 1
  }

  if (segment.length === 0) throw new Error('Workspace file folder path contains an empty name')
  segments.push(segment)
  return segments
}
