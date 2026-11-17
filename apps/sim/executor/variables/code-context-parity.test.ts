/**
 * The workflow-code package ports the executor's JavaScript string scanner
 * (`getCodeStringQuoteContext`) so the code-file rewrite agrees with the runtime about which
 * `<ref>` positions are code. The two must classify every offset of the same code alike; the one
 * deliberate difference is that the port reports a comment as its own context where the runtime
 * reports code.
 */
import { createJsContextScanner } from '@sim/workflow-code'
import { describe, expect, it } from 'vitest'
import { ExecutionState } from '@/executor/execution/state'
import { VariableResolver } from '@/executor/variables/resolver'

const CASES = [
  `return <start.input>`,
  `const a = '<start.x>'; const b = "<start.y>"; return a + b`,
  `const t = \`hi \${<start.name>} and \${'<start.q>'}\`; return t`,
  `const nested = \`a \${\`b \${<start.c>}\`} d\``,
  `if (x) /<start.re>/.test(y)`,
  `const half = (a + b) / 2 / <start.n>`,
  `return typeof /<start.re>/ === 'object'`,
  `const r = /[/'"]<start.x>/g; return r`,
  `// <start.comment>\nreturn <start.after>`,
  `/* '<start.block>' */ return "<start.tail>"`,
  `let i = 0; i++ / <start.div> / 2`,
  `obj.if(<start.arg>) / 2`,
  `const s = 'unterminated\nreturn <start.next>'`,
  `const e = 'esc \\' <start.in>' + <start.out>`,
  `while (ok) /x/.exec(<start.s>)`,
  `return \`\${a / <start.b> / c}\` + \`\${/<start.re>/}\``,
  `const x = a\n/<start.re>/g.test(b)`,
  `return await /<start.re>/.exec(s)`,
]

/** The resolver's private scanner, reached by name since only the resolver itself calls it. */
const RUNTIME_SCANNER = 'getCodeStringQuoteContext'

/** The runtime's classification: `null` for code, the quote kind inside a string, template or regex. */
function runtimeContexts(resolver: VariableResolver, code: string): unknown[] {
  const scan = { template: code }
  const contexts: unknown[] = []
  for (let index = 0; index <= code.length; index++) {
    contexts.push(resolver[RUNTIME_SCANNER](scan, index, 'javascript'))
  }
  return contexts
}

/** The port's classification, with its comment context folded into code as the runtime reports it. */
function portContexts(code: string): unknown[] {
  const scanner = createJsContextScanner(code)
  const contexts: unknown[] = []
  for (let index = 0; index <= code.length; index++) {
    const context = scanner.contextAt(index)
    contexts.push(context === 'code' || context === 'comment' ? null : context)
  }
  return contexts
}

describe('JavaScript string context parity', () => {
  const resolver = new VariableResolver(
    { version: '1', blocks: [], connections: [], loops: {}, parallels: {} },
    {},
    new ExecutionState()
  )

  it.each(CASES)('classifies every offset of %j alike', (code) => {
    expect(portContexts(code)).toEqual(runtimeContexts(resolver, code))
  })
})
