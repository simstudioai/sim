import { sanitize } from '../../output/render.js'

const ESC = String.fromCharCode(27)
const RESET = `${ESC}[0m`
const BOLD = `${ESC}[1m`
const DIM = `${ESC}[2m`
const ITALIC = `${ESC}[3m`
const CYAN = `${ESC}[36m`
const MAX_LINK_LABEL_LENGTH = 256
const MAX_LINK_DESTINATION_LENGTH = 2_048

interface InlineStyle {
  bold: boolean
  italic: boolean
  code: boolean
}

/**
 * A deliberately small streaming Markdown renderer for interactive chat.
 *
 * It does not parse HTML and it never accepts terminal escapes from the model:
 * input is sanitized first, then the renderer adds its own fixed SGR
 * sequences. Markdown links intentionally render as their visible label only;
 * terminal hyperlink support varies and hidden destinations are surprising in
 * a CLI transcript. Unlike a whole-document Markdown parser, this keeps ordinary prose
 * streaming as soon as it arrives. Only a possible Markdown link is buffered
 * until its closing `)` makes the URL safe to validate.
 */
export class ChatMarkdownStream {
  private readonly style: InlineStyle = { bold: false, italic: false, code: false }
  private pending = ''
  private atLineStart = true
  private inFence = false

  constructor(private readonly enabled: boolean) {}

  push(fragment: string): string {
    const safe = sanitize(fragment)
    if (!this.enabled) return safe
    this.pending += safe
    return this.drain(false)
  }

  /** Flushes an inline prefix before a trusted structured tag is written. */
  flushInline(): string {
    if (!this.enabled || !this.pending) return ''
    return this.drain(true)
  }

  finish(): string {
    if (!this.enabled) return ''
    const rendered = this.drain(true)
    return rendered + (this.hasStyle() ? this.resetStyles() : '')
  }

  private drain(final: boolean): string {
    let output = ''

    while (this.pending) {
      if (this.atLineStart) {
        const prefix = this.consumeLinePrefix(final)
        if (prefix === null) break
        output += prefix
        if (!this.pending) break
      }

      if (this.pending.startsWith('\n')) {
        this.pending = this.pending.slice(1)
        output += this.resetStyles()
        output += '\n'
        this.atLineStart = true
        continue
      }

      if (this.inFence) {
        const newline = this.pending.indexOf('\n')
        const amount = newline === -1 ? (final ? this.pending.length : 0) : newline
        if (amount === 0) break
        output += `${DIM}${this.pending.slice(0, amount)}${RESET}`
        this.pending = this.pending.slice(amount)
        continue
      }

      const link = this.tryMarkdownLink(final)
      if (link.kind === 'wait') break
      if (link.kind === 'rendered') {
        output += link.value
        continue
      }

      if (this.pending.startsWith('`')) {
        this.pending = this.pending.slice(1)
        this.style.code = !this.style.code
        output += this.applyStyles()
        continue
      }
      // Workspace identifiers and file names commonly contain underscores, so
      // only asterisks act as emphasis delimiters in this compact renderer.
      if (!this.style.code && this.pending.startsWith('**')) {
        this.pending = this.pending.slice(2)
        this.style.bold = !this.style.bold
        output += this.applyStyles()
        continue
      }
      if (!this.style.code && this.pending.startsWith('*')) {
        if (!final && this.pending.length === 1) break
        this.pending = this.pending.slice(1)
        this.style.italic = !this.style.italic
        output += this.applyStyles()
        continue
      }

      // A trailing marker may be the first half of a delimiter in the next SSE
      // chunk. Hold it for one beat instead of briefly printing raw Markdown.
      if (!final && this.pending.length === 1 && /[[\]*`]/u.test(this.pending)) break

      output += this.pending[0]
      this.pending = this.pending.slice(1)
    }

    return output
  }

  private consumeLinePrefix(final: boolean): string | null {
    const newline = this.pending.indexOf('\n')
    const candidate = newline === -1 ? this.pending : this.pending.slice(0, newline)
    if (!final && newline === -1 && candidate.length < 4 && /^[#>*+\-\d. `]*$/u.test(candidate)) {
      return null
    }

    const fence = candidate.match(/^\s*```\s*([^\s`]*)\s*$/u)
    if (fence) {
      this.pending = this.pending.slice(candidate.length)
      this.inFence = !this.inFence
      this.atLineStart = false
      return this.inFence ? `${DIM}┌─${fence[1] ? ` ${fence[1]}` : ''}${RESET}` : `${DIM}└─${RESET}`
    }

    if (this.inFence) {
      this.atLineStart = false
      return ''
    }

    const heading = candidate.match(/^\s{0,3}#{1,6}\s+/u)
    if (heading) {
      this.pending = this.pending.slice(heading[0].length)
      this.style.bold = true
      this.atLineStart = false
      return BOLD
    }

    const bullet = candidate.match(/^(\s{0,8})[-+*]\s+/u)
    if (bullet) {
      this.pending = this.pending.slice(bullet[0].length)
      this.atLineStart = false
      return `${bullet[1]}${DIM}•${RESET} ${this.applyStyles(false)}`
    }

    const quote = candidate.match(/^(\s{0,3})>\s?/u)
    if (quote) {
      this.pending = this.pending.slice(quote[0].length)
      this.atLineStart = false
      return `${quote[1]}${DIM}│${RESET} `
    }

    const rule = candidate.match(/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/u)
    if (rule) {
      this.pending = this.pending.slice(candidate.length)
      this.atLineStart = false
      return `${DIM}${'─'.repeat(24)}${RESET}`
    }

    this.atLineStart = false
    return ''
  }

  private tryMarkdownLink(
    final: boolean
  ): { kind: 'none' } | { kind: 'wait' } | { kind: 'rendered'; value: string } {
    if (!this.pending.startsWith('[') || this.style.code || this.inFence) return { kind: 'none' }

    const labelEnd = this.pending.indexOf('](')
    if (labelEnd === -1) {
      const couldStillBeLink =
        !final && !this.pending.includes('\n') && this.pending.length <= MAX_LINK_LABEL_LENGTH + 2
      return couldStillBeLink ? { kind: 'wait' } : { kind: 'none' }
    }
    const label = this.pending.slice(1, labelEnd)
    if (!label || label.includes('\n') || label.length > MAX_LINK_LABEL_LENGTH) {
      return { kind: 'none' }
    }

    let depth = 1
    let escaped = false
    let end = labelEnd + 2
    for (; end < this.pending.length; end += 1) {
      if (end - labelEnd - 2 > MAX_LINK_DESTINATION_LENGTH) return { kind: 'none' }
      const character = this.pending[end]
      if (escaped) {
        escaped = false
        continue
      }
      if (character === '\\') {
        escaped = true
        continue
      }
      if (character === '(') depth += 1
      if (character === ')') {
        depth -= 1
        if (depth === 0) break
      }
      if (character === '\n') return { kind: 'none' }
    }
    if (end >= this.pending.length) {
      const destinationLength = this.pending.length - labelEnd - 2
      return !final && destinationLength <= MAX_LINK_DESTINATION_LENGTH
        ? { kind: 'wait' }
        : { kind: 'none' }
    }

    this.pending = this.pending.slice(end + 1)
    return { kind: 'rendered', value: label }
  }

  private hasStyle(): boolean {
    return this.style.bold || this.style.italic || this.style.code
  }

  private resetStyles(): string {
    const hadStyle = this.hasStyle()
    this.style.bold = false
    this.style.italic = false
    this.style.code = false
    return hadStyle ? RESET : ''
  }

  private applyStyles(reset = true): string {
    let output = reset ? RESET : ''
    if (this.style.bold) output += BOLD
    if (this.style.italic) output += ITALIC
    if (this.style.code) output += `${CYAN}${DIM}`
    return output
  }
}
