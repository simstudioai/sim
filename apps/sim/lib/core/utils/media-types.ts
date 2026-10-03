const QUALITY_VALUE = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/

/** Splits an HTTP list or parameter list without cutting inside quoted strings. */
function splitOutsideQuotes(value: string, separator: ',' | ';'): string[] | null {
  const parts: string[] = []
  let start = 0
  let quoted = false
  let escaped = false

  for (let index = 0; index < value.length; index++) {
    const character = value[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (quoted && character === '\\') {
      escaped = true
      continue
    }
    if (character === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && character === separator) {
      parts.push(value.slice(start, index))
      start = index + 1
    }
  }

  if (quoted || escaped) return null
  parts.push(value.slice(start))
  return parts
}

/**
 * Whether an Accept header explicitly permits a media type.
 *
 * Wildcards do not opt callers into a streaming protocol, and a matching range
 * with an invalid or zero quality value is not acceptable.
 */
export function acceptsMediaType(acceptHeader: string | null, mediaType: string): boolean {
  if (!acceptHeader) return false
  const normalizedMediaType = mediaType.trim().toLowerCase()
  const ranges = splitOutsideQuotes(acceptHeader, ',')
  if (!ranges) return false

  return ranges.some((range) => {
    const parts = splitOutsideQuotes(range, ';')
    if (!parts) return false
    const [type, ...parameters] = parts
    if (type.trim().toLowerCase() !== normalizedMediaType) return false

    const qualityParameters = parameters.filter((parameter) => {
      const separator = parameter.indexOf('=')
      const name = separator === -1 ? parameter : parameter.slice(0, separator)
      return name.trim().toLowerCase() === 'q'
    })
    if (qualityParameters.length === 0) return true
    if (qualityParameters.length > 1) return false

    const qualityParameter = qualityParameters[0]
    const separator = qualityParameter.indexOf('=')
    const quality = separator === -1 ? '' : qualityParameter.slice(separator + 1).trim()
    return QUALITY_VALUE.test(quality) && Number(quality) > 0
  })
}
