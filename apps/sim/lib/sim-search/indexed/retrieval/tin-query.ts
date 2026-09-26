/**
 * Translates PostgreSQL's text rendering of a `tsquery` into TINQL, the query language of the Tin
 * text index. The keyword leg already derives its `tsquery` with `websearch_to_tsquery`, so the
 * lexemes arrive stemmed by the same configuration that stemmed the indexed text; translating
 * them keeps Tin matching the same documents the GIN path matches, without re-implementing
 * stemming.
 *
 * Supported shapes are the ones `websearch_to_tsquery` produces: `&`, `|`, `!` applied to a
 * lexeme, phrases of lexemes joined by `<->` or `<N>`, and parentheses. TINQL has no standalone
 * negation, so a query that is only negated, or negates inside a disjunction, has no translation
 * and returns `null`; the caller then keeps the GIN path.
 */

type Node =
  | { kind: 'term'; lexeme: string }
  | { kind: 'phrase'; terms: string[]; gaps: number[] }
  | { kind: 'not'; operand: Node }
  | { kind: 'and'; operands: Node[] }
  | { kind: 'or'; operands: Node[] }

type Token =
  | { kind: 'lexeme'; value: string }
  | { kind: 'and' | 'or' | 'not' | 'open' | 'close' }
  | { kind: 'follow'; distance: number }

class UntranslatableQuery extends Error {}

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === ' ') {
      index++
    } else if (char === "'") {
      let value = ''
      index++
      for (;;) {
        if (index >= text.length) throw new UntranslatableQuery('unterminated lexeme')
        if (text[index] === "'" && text[index + 1] === "'") {
          value += "'"
          index += 2
        } else if (text[index] === "'") {
          index++
          break
        } else {
          value += text[index++]
        }
      }
      /** Weight and prefix suffixes (`:A`, `:*`) change matching and are never emitted by websearch. */
      if (text[index] === ':') throw new UntranslatableQuery('lexeme modifiers')
      tokens.push({ kind: 'lexeme', value })
    } else if (char === '&') {
      tokens.push({ kind: 'and' })
      index++
    } else if (char === '|') {
      tokens.push({ kind: 'or' })
      index++
    } else if (char === '!') {
      tokens.push({ kind: 'not' })
      index++
    } else if (char === '(') {
      tokens.push({ kind: 'open' })
      index++
    } else if (char === ')') {
      tokens.push({ kind: 'close' })
      index++
    } else if (char === '<') {
      const end = text.indexOf('>', index)
      if (end < 0) throw new UntranslatableQuery('unterminated distance')
      const body = text.slice(index + 1, end)
      const distance = body === '-' ? 1 : Number(body)
      if (!Number.isInteger(distance) || distance < 1) {
        throw new UntranslatableQuery('unsupported distance')
      }
      tokens.push({ kind: 'follow', distance })
      index = end + 1
    } else {
      throw new UntranslatableQuery(`unexpected character ${char}`)
    }
  }
  return tokens
}

/** Recursive descent over tsquery precedence: `|` binds loosest, then `&`, then `<N>`, then `!`. */
function parse(tokens: Token[]): Node {
  let position = 0
  const peek = () => tokens[position]

  function parseOr(): Node {
    const operands = [parseAnd()]
    while (peek()?.kind === 'or') {
      position++
      operands.push(parseAnd())
    }
    return operands.length === 1 ? operands[0] : { kind: 'or', operands }
  }

  function parseAnd(): Node {
    const operands = [parseFollow()]
    while (peek()?.kind === 'and') {
      position++
      operands.push(parseFollow())
    }
    return operands.length === 1 ? operands[0] : { kind: 'and', operands }
  }

  function parseFollow(): Node {
    const first = parseUnary()
    if (peek()?.kind !== 'follow') return first
    if (first.kind !== 'term') throw new UntranslatableQuery('phrase over a compound operand')
    const terms = [first.lexeme]
    const gaps: number[] = []
    for (let token = peek(); token?.kind === 'follow'; token = peek()) {
      position++
      const next = parseUnary()
      if (next.kind !== 'term') throw new UntranslatableQuery('phrase over a compound operand')
      gaps.push(token.distance)
      terms.push(next.lexeme)
    }
    return { kind: 'phrase', terms, gaps }
  }

  function parseUnary(): Node {
    const token = tokens[position++]
    if (!token) throw new UntranslatableQuery('unexpected end')
    if (token.kind === 'not') return { kind: 'not', operand: parseUnary() }
    if (token.kind === 'lexeme') return { kind: 'term', lexeme: token.value }
    if (token.kind === 'open') {
      const inner = parseOr()
      if (tokens[position++]?.kind !== 'close') throw new UntranslatableQuery('unbalanced group')
      return inner
    }
    throw new UntranslatableQuery(`unexpected ${token.kind}`)
  }

  const root = parseOr()
  if (position !== tokens.length) throw new UntranslatableQuery('trailing input')
  return root
}

/** A lexeme is always quoted, so reserved words and punctuation stay literal terms. */
function quote(lexeme: string): string {
  return `"${lexeme.replace(/[\\"_[\]]/g, (char) => `\\${char}`)}"`
}

function render(node: Node): string {
  switch (node.kind) {
    case 'term':
      return quote(node.lexeme)
    case 'phrase':
      /**
       * Adjacent lexemes form a phrase. A wider gap marks stopwords the analyzer removed; the
       * indexed stream omits them too, so the gap becomes ordered proximity within that distance.
       */
      if (node.gaps.every((gap) => gap === 1)) {
        return `"${node.terms.map((term) => quote(term).slice(1, -1)).join(' ')}"`
      }
      return `(${node.terms
        .map((term, index) =>
          index === 0 ? quote(term) : `THEN/${node.gaps[index - 1]} ${quote(term)}`
        )
        .join(' ')})`
    case 'not':
      throw new UntranslatableQuery('negation outside a conjunction')
    case 'and': {
      const positive = node.operands.filter((operand) => operand.kind !== 'not')
      const negative = node.operands.filter(
        (operand): operand is Extract<Node, { kind: 'not' }> => operand.kind === 'not'
      )
      if (positive.length === 0) throw new UntranslatableQuery('conjunction of negations only')
      return `(${[
        positive.map(render).join(' AND '),
        ...negative.map((operand) => `NOT ${render(operand.operand)}`),
      ].join(' AND ')})`
    }
    case 'or':
      return `(${node.operands.map(render).join(' OR ')})`
  }
}

/**
 * The TINQL equivalent of a rendered `tsquery`, or `null` when the query has no lexemes or uses a
 * shape TINQL cannot express.
 */
export function tinQueryFromTsquery(rendered: string): string | null {
  const text = rendered.trim()
  if (!text) return null
  try {
    return render(parse(tokenize(text)))
  } catch (error) {
    if (error instanceof UntranslatableQuery) return null
    throw error
  }
}
