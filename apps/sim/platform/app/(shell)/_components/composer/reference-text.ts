import {
  type ComposerOption,
  prefixFor,
} from '@/platform/app/(shell)/_components/composer/reference-options'

interface MatchedReference {
  start: number
  end: number
  item: ComposerOption
}

const BOUNDARY = /^[\s.,;:!?(){}[\]"'`/\\<>]$/

export function matchReferences(
  text: string,
  selected: readonly ComposerOption[],
  options: readonly ComposerOption[]
) {
  const result: MatchedReference[] = []
  for (const match of text.matchAll(/(?:^|(?<=\s))[@/]/g)) {
    const start = match.index
    if (start < (result.at(-1)?.end ?? 0)) continue
    const prefix = match[0]
    function matches(item: ComposerOption, requireBoundary: boolean) {
      if (prefixFor(item.group) !== prefix) return false
      const end = start + 1 + item.name.length
      return (
        text.slice(start + 1, end).toLowerCase() === item.name.toLowerCase() &&
        (end === text.length ? !requireBoundary : BOUNDARY.test(text[end]))
      )
    }
    const picked = selected.filter((item) => matches(item, false))
    // Only unambiguous, completed names can resolve without an explicit menu selection.
    const candidates = picked.length ? picked : options.filter((item) => matches(item, true))
    const longest = Math.max(0, ...candidates.map((item) => item.name.length))
    const best = candidates.filter((item) => item.name.length === longest)
    if (best.length === 1) result.push({ start, end: start + 1 + longest, item: best[0] })
  }
  return result
}

export function triggerAt(text: string, caret: number, matches: readonly MatchedReference[]) {
  const line = text.slice(0, caret)
  const start = Math.max(line.lastIndexOf('@'), line.lastIndexOf('/'))
  if (
    start < 0 ||
    (start > 0 && !/\s/.test(line[start - 1])) ||
    matches.some((mark) => mark.start === start)
  )
    return null
  const prefix = line[start]
  const query = line.slice(start + 1)
  if (prefix === '@' ? /^\s|[\r\n]/.test(query) : /[\s.,;:!?(){}[\]"'`/\\<>]/.test(query))
    return null
  return { prefix, query, start, end: caret }
}
