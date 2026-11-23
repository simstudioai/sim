import { parse } from '@babel/parser'
import type { Node } from '@babel/types'
import { utf8ByteLength } from '@sim/utils/paste'
import { childNodes, literalText } from '../babel'
import { bracketDepthOverflow, PARSER_OPTIONS } from '../compile/parse'
import { SOURCE_LIMITS } from '../limits'
import { SDK_MODULE } from '../sdk'

/** The SDK export a function block's code file is read through. */
const CODE_FILE_EXPORT = 'codeFile'

/**
 * The paths an entry file passes to `codeFile(…)`, parsed as compile parses it: Babel with the
 * TypeScript plugin, the SDK's named imports bound by their local names (so `codeFile as file`
 * counts), and only a single constant argument. Comments and literals that merely spell
 * `codeFile(` are not calls. Lets a client send the files a source references before the server
 * compiles it. A file over the byte or nesting caps, or one Babel cannot parse, answers what it
 * can (possibly nothing): the server refuses it with the full diagnostics.
 */
export function codeFileReferences(text: string): string[] {
  if (utf8ByteLength(text, SOURCE_LIMITS.maxTotalBytes) > SOURCE_LIMITS.maxTotalBytes) return []
  if (bracketDepthOverflow(text, SOURCE_LIMITS.maxDepth) !== -1) return []
  let program: Node
  try {
    program = parse(text, PARSER_OPTIONS).program
  } catch {
    return []
  }

  const callees = new Set<string>()
  for (const statement of program.type === 'Program' ? program.body : []) {
    if (statement.type !== 'ImportDeclaration') continue
    if (statement.source.value !== SDK_MODULE || statement.importKind === 'type') continue
    for (const specifier of statement.specifiers) {
      if (specifier.type !== 'ImportSpecifier' || specifier.importKind === 'type') continue
      const imported =
        specifier.imported.type === 'Identifier'
          ? specifier.imported.name
          : specifier.imported.value
      if (imported === CODE_FILE_EXPORT) callees.add(specifier.local.name)
    }
  }
  if (callees.size === 0) return []

  const paths = new Set<string>()
  const stack: Node[] = [program]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) break
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      callees.has(node.callee.name) &&
      node.arguments.length === 1
    ) {
      const path = literalText(node.arguments[0])
      if (path !== null) paths.add(path)
    }
    for (const child of childNodes(node)) stack.push(child)
  }
  return [...paths]
}
