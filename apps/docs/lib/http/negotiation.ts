interface MediaRange {
  type: string
  quality: number
}

/** Uses the most specific range for each representation, then prefers HTML on ties. */
export function prefersMarkdown(accept: string | null): boolean {
  if (!accept) return false
  const ranges: MediaRange[] = accept.split(',').map((entry) => {
    const [type, ...parameters] = entry.trim().toLowerCase().split(';')
    const qualityParameter = parameters.find((parameter) => parameter.trim().startsWith('q='))
    const quality = qualityParameter ? Number(qualityParameter.trim().slice(2)) : 1
    return {
      type: type.trim(),
      quality: Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0,
    }
  })
  const qualityFor = (type: string) => {
    for (const candidate of [type, 'text/*', '*/*']) {
      const matches = ranges.filter((range) => range.type === candidate)
      if (matches.length) return Math.max(...matches.map((range) => range.quality))
    }
    return 0
  }
  return qualityFor('text/markdown') > qualityFor('text/html')
}
