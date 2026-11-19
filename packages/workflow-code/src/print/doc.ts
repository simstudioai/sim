/**
 * A Wadler-style document printer that reproduces the layout decisions Biome (and Prettier, which
 * Biome mirrors) make for the subset of TypeScript the workflow printer emits. Printed
 * files must be a Biome fixed point, so the algorithm follows Prettier's `printDocToString`:
 * groups print flat when the rest of the line fits, conditional groups try their states in order,
 * and a hard line inside a group breaks it (except conditional groups, which choose for
 * themselves).
 */

export type Doc =
  | string
  | Doc[]
  | { type: 'group'; contents: Doc; break: boolean; states?: Doc[] }
  | { type: 'indent'; contents: Doc }
  | { type: 'line'; soft: boolean; hard: boolean; literal: boolean }
  | { type: 'ifBreak'; breakContents: Doc; flatContents: Doc }
  | {
      type: 'fill'
      parts: Doc[]
      /** The index of the first part left to print; the printer advances it instead of copying. */
      offset?: number
    }
  | { type: 'lineSuffix'; contents: Doc }
  | { type: 'breakParent' }

export const line: Doc = { type: 'line', soft: false, hard: false, literal: false }
export const softline: Doc = { type: 'line', soft: true, hard: false, literal: false }
const hardLineOnly: Doc = { type: 'line', soft: false, hard: true, literal: false }
const literalLineOnly: Doc = { type: 'line', soft: false, hard: true, literal: true }
export const breakParent: Doc = { type: 'breakParent' }
export const hardline: Doc = [hardLineOnly, breakParent]
/** A newline that resets the column to 0: template-literal content is never re-indented. */
const literalline: Doc = [literalLineOnly, breakParent]

/** Prettier's `group`: flat when the rest of the line fits, else every line inside breaks. */
export function group(contents: Doc, options: { shouldBreak?: boolean } = {}): Doc {
  return { type: 'group', contents, break: options.shouldBreak === true }
}

/** Prettier's `conditionalGroup`: the first state that fits flat wins, else the last breaks. */
export function conditionalGroup(states: Doc[]): Doc {
  return { type: 'group', contents: states[0] ?? '', break: false, states }
}

/** Indents every line `contents` breaks onto by one level. */
export function indent(contents: Doc): Doc {
  return { type: 'indent', contents }
}

/** `breakContents` when the enclosing group breaks, else `flatContents`. */
export function ifBreak(breakContents: Doc, flatContents: Doc = ''): Doc {
  return { type: 'ifBreak', breakContents, flatContents }
}

/** Prettier's `fill`: alternating content and separators; only an overflowing separator breaks. */
export function fill(parts: Doc[]): Doc {
  return { type: 'fill', parts }
}

/** Defers `contents` to the end of the current line (a trailing comment). */
export function lineSuffix(contents: Doc): Doc {
  return { type: 'lineSuffix', contents }
}

/** `docs` with `separator` between each pair. */
export function join(separator: Doc, docs: Doc[]): Doc[] {
  const out: Doc[] = []
  docs.forEach((doc, index) => {
    if (index > 0) out.push(separator)
    out.push(doc)
  })
  return out
}

/** Text that may contain `\n`: each newline becomes a `literalline`. */
export function literalText(text: string): Doc {
  if (!text.includes('\n')) return text
  return join(literalline, text.split('\n'))
}

/** True when the doc contains a forced break (Prettier's `willBreak`). */
export function willBreak(doc: Doc): boolean {
  if (typeof doc === 'string') return false
  if (Array.isArray(doc)) return doc.some(willBreak)
  switch (doc.type) {
    case 'group':
      return doc.break || willBreak(doc.contents)
    case 'indent':
    case 'lineSuffix':
      return willBreak(doc.contents)
    case 'line':
      return doc.hard
    case 'breakParent':
      return true
    case 'ifBreak':
      return willBreak(doc.breakContents) || willBreak(doc.flatContents)
    case 'fill':
      return doc.parts.some(willBreak)
  }
}

/**
 * Marks every non-conditional group that contains a `breakParent` as broken, bottom-up
 * (Prettier's `propagateBreaks`). Returns whether `doc` contains one.
 */
function propagateBreaks(doc: Doc): boolean {
  if (typeof doc === 'string') return false
  if (Array.isArray(doc)) {
    let found = false
    for (const child of doc) if (propagateBreaks(child)) found = true
    return found
  }
  switch (doc.type) {
    case 'breakParent':
      return true
    case 'group': {
      let found = propagateBreaks(doc.contents)
      if (doc.states) {
        for (const state of doc.states.slice(1)) if (propagateBreaks(state)) found = true
        return false
      }
      if (found) doc.break = true
      return doc.break || found
    }
    case 'indent':
    case 'lineSuffix':
      return propagateBreaks(doc.contents)
    case 'ifBreak': {
      const a = propagateBreaks(doc.breakContents)
      const b = propagateBreaks(doc.flatContents)
      return a || b
    }
    case 'fill': {
      let found = false
      for (const part of doc.parts) if (propagateBreaks(part)) found = true
      return found
    }
    case 'line':
      return false
  }
}

type Mode = 'flat' | 'break'

interface Command {
  indent: number
  mode: Mode
  doc: Doc
}

/**
 * Display width in columns. Wide East Asian characters and emoji count as two, combining marks as
 * zero, matching the `unicode-width` rules Biome measures with closely enough for workflow text.
 */
export function stringWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || (code >= 0x7f && code < 0xa0)) continue
    if ((code >= 0x300 && code <= 0x36f) || (code >= 0xfe00 && code <= 0xfe0f) || code === 0x200d) {
      continue
    }
    width += isWide(code) ? 2 : 1
  }
  return width
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
}

function fits(next: Command, rest: Command[], initialWidth: number, mustBeFlat: boolean): boolean {
  let width = initialWidth
  let restIndex = rest.length
  const commands: Array<{ mode: Mode; doc: Doc }> = [{ mode: next.mode, doc: next.doc }]
  while (width >= 0) {
    let current = commands.pop()
    if (!current) {
      if (restIndex === 0) return true
      const restCommand = rest[restIndex - 1]
      restIndex -= 1
      if (!restCommand) return true
      current = { mode: restCommand.mode, doc: restCommand.doc }
    }
    const { mode, doc } = current
    if (typeof doc === 'string') {
      width -= stringWidth(doc)
      continue
    }
    if (Array.isArray(doc)) {
      for (let i = doc.length - 1; i >= 0; i -= 1) {
        const child = doc[i]
        if (child !== undefined) commands.push({ mode, doc: child })
      }
      continue
    }
    switch (doc.type) {
      case 'indent':
        commands.push({ mode, doc: doc.contents })
        break
      case 'group': {
        if (mustBeFlat && doc.break) return false
        const groupMode: Mode = doc.break ? 'break' : mode
        const contents =
          doc.states && groupMode === 'break' ? (doc.states.at(-1) ?? doc.contents) : doc.contents
        commands.push({ mode: groupMode, doc: contents })
        break
      }
      case 'ifBreak':
        commands.push({ mode, doc: mode === 'break' ? doc.breakContents : doc.flatContents })
        break
      case 'fill':
        for (let i = doc.parts.length - 1; i >= (doc.offset ?? 0); i -= 1) {
          const part = doc.parts[i]
          if (part !== undefined) commands.push({ mode, doc: part })
        }
        break
      case 'line':
        if (mode === 'break' || doc.hard) return true
        if (!doc.soft) width -= 1
        break
      case 'lineSuffix':
      case 'breakParent':
        break
    }
  }
  return false
}

/** Renders a doc to text at the given width with 2-space indentation and LF line endings. */
export function printDoc(root: Doc, width: number): string {
  propagateBreaks(root)
  /** Output pieces, joined once at the end: trimming a line end touches only the last pieces. */
  const output: string[] = []
  let column = 0
  /** Set after a hard line inside flat content: later flat groups must measure again. */
  let shouldRemeasure = false
  const lineSuffixes: Command[] = []
  const commands: Command[] = [{ indent: 0, mode: 'break', doc: root }]

  const trimTrailing = () => {
    while (output.length > 0) {
      const last = output[output.length - 1]
      let end = last.length
      while (end > 0 && (last[end - 1] === ' ' || last[end - 1] === '\t')) end -= 1
      column -= last.length - end
      if (end > 0) {
        output[output.length - 1] = last.slice(0, end)
        return
      }
      output.pop()
    }
  }

  while (commands.length > 0) {
    const command = commands.pop()
    if (!command) break
    const { indent: ind, mode, doc } = command
    if (typeof doc === 'string') {
      output.push(doc)
      column += stringWidth(doc)
      continue
    }
    if (Array.isArray(doc)) {
      for (let i = doc.length - 1; i >= 0; i -= 1) {
        const child = doc[i]
        if (child !== undefined) commands.push({ indent: ind, mode, doc: child })
      }
      continue
    }
    switch (doc.type) {
      case 'indent':
        commands.push({ indent: ind + 2, mode, doc: doc.contents })
        break
      case 'group': {
        if (mode === 'flat' && !shouldRemeasure) {
          commands.push({ indent: ind, mode: doc.break ? 'break' : 'flat', doc: doc.contents })
          break
        }
        shouldRemeasure = false
        const next: Command = { indent: ind, mode: 'flat', doc: doc.contents }
        const remaining = width - column
        if (!doc.break && fits(next, commands, remaining, false)) {
          commands.push(next)
          break
        }
        if (!doc.states) {
          commands.push({ indent: ind, mode: 'break', doc: doc.contents })
          break
        }
        const mostExpanded = doc.states.at(-1) ?? doc.contents
        if (doc.break) {
          commands.push({ indent: ind, mode: 'break', doc: mostExpanded })
          break
        }
        let chosen: Command | null = null
        for (let i = 1; i < doc.states.length; i += 1) {
          const state = doc.states[i]
          if (state === undefined) continue
          const candidate: Command = { indent: ind, mode: 'flat', doc: state }
          if (fits(candidate, commands, remaining, false)) {
            chosen = candidate
            break
          }
        }
        commands.push(chosen ?? { indent: ind, mode: 'break', doc: mostExpanded })
        break
      }
      case 'ifBreak':
        commands.push({
          indent: ind,
          mode,
          doc: mode === 'break' ? doc.breakContents : doc.flatContents,
        })
        break
      case 'fill':
        printFill(doc.parts, doc.offset ?? 0, ind, mode, commands, width - column)
        break
      case 'lineSuffix':
        lineSuffixes.push({ indent: ind, mode, doc: doc.contents })
        break
      case 'breakParent':
        break
      case 'line': {
        if (mode === 'flat' && !doc.hard) {
          if (!doc.soft) {
            output.push(' ')
            column += 1
          }
          break
        }
        if (mode === 'flat') shouldRemeasure = true
        if (lineSuffixes.length > 0) {
          commands.push(command)
          while (lineSuffixes.length > 0) {
            const suffix = lineSuffixes.pop()
            if (suffix) commands.push(suffix)
          }
          break
        }
        if (doc.literal) {
          output.push('\n')
          column = 0
        } else {
          trimTrailing()
          output.push(`\n${' '.repeat(ind)}`)
          column = ind
        }
        break
      }
    }
  }
  return output.join('')
}

/**
 * Prettier's fill: content/separator pairs, each separator breaking only when the next part
 * overflows. The rest of the fill is queued as the same parts from a later `offset`, so a long
 * fill prints in linear time.
 */
function printFill(
  parts: Doc[],
  offset: number,
  ind: number,
  mode: Mode,
  commands: Command[],
  remaining: number
) {
  const content = parts[offset]
  const separator = parts[offset + 1]
  const nextContent = parts[offset + 2]
  if (content === undefined) return
  const contentFlat: Command = { indent: ind, mode: 'flat', doc: content }
  const contentFits = fits(contentFlat, [], remaining, true)
  if (separator === undefined) {
    commands.push(contentFits ? contentFlat : { indent: ind, mode: 'break', doc: content })
    return
  }
  const restCommand: Command = {
    indent: ind,
    mode,
    doc: { type: 'fill', parts, offset: offset + 2 },
  }
  if (nextContent === undefined) {
    commands.push(restCommand)
    commands.push({ indent: ind, mode: contentFits ? 'flat' : 'break', doc: separator })
    commands.push(contentFits ? contentFlat : { indent: ind, mode: 'break', doc: content })
    return
  }
  const pairFits = fits(
    { indent: ind, mode: 'flat', doc: [content, separator, nextContent] },
    [],
    remaining,
    true
  )
  commands.push(restCommand)
  commands.push({ indent: ind, mode: pairFits ? 'flat' : 'break', doc: separator })
  commands.push(contentFits ? contentFlat : { indent: ind, mode: 'break', doc: content })
}
