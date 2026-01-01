/**
 * JavaScript to Python transpilation utilities.
 * This runs at export time so the exported service doesn't need a transpiler.
 */

/**
 * Transpile JavaScript code to Python.
 */
export function transpileJsToPython(code: string): string {
  // Transform comments
  code = code.replace(/\/\/(.*)$/gm, '#$1')

  // Transform var/let/const declarations
  code = code.replace(/\b(var|let|const)\s+/g, '')

  // Transform operators
  code = code.replace(/===/g, '==')
  code = code.replace(/!==/g, '!=')
  code = code.replace(/&&/g, ' and ')
  code = code.replace(/\|\|/g, ' or ')
  // Be careful with ! - only replace standalone not
  code = code.replace(/(?<![a-zA-Z0-9_])!(?![=])/g, 'not ')

  // Transform literals (use word boundaries to avoid partial matches)
  code = code.replace(/\bnull\b/g, 'None')
  code = code.replace(/\bundefined\b/g, 'None')
  code = code.replace(/\btrue\b/g, 'True')
  code = code.replace(/\bfalse\b/g, 'False')

  // Transform array methods - handle .length property
  code = code.replace(/(\b[a-zA-Z_][a-zA-Z0-9_]*(?:\[[^\]]*\])*)\.length\b/g, 'len($1)')
  code = code.replace(/\.push\(/g, '.append(')
  code = code.replace(/Array\.isArray\(([^)]+)\)/g, 'isinstance($1, list)')

  // Wrap len() with str() when used in string concatenation
  // Pattern: 'string' + len(...) or len(...) + 'string'
  code = code.replace(/(['"][^'"]*['"])\s*\+\s*(len\([^)]+\))/g, '$1 + str($2)')
  code = code.replace(/(len\([^)]+\))\s*\+\s*(['"][^'"]*['"])/g, 'str($1) + $2')

  // Transform property access (but not method calls)
  // Note: This handles simple bracket notation like arr[0].prop but not deeply nested
  // patterns like arr[obj["key"]].prop. For complex cases, use bracket notation in source.
  code = code.replace(
    /\b([a-zA-Z_][a-zA-Z0-9_]*(?:\["[^"]*"\]|\['[^']*'\]|\[\d+\])*)\.([a-zA-Z_][a-zA-Z0-9_]*)(?![a-zA-Z0-9_])(?!\s*\()/g,
    '$1["$2"]'
  )

  // Transform object literal keys: { key: value } -> { 'key': value }
  code = code.replace(/\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, "{ '$1':")
  code = code.replace(/,\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, ", '$1':")

  // Transform control structures
  const lines = code.split('\n')
  const result: string[] = []

  for (const line of lines) {
    const stripped = line.trim()
    const leading = line.length - line.trimStart().length
    const indent = ' '.repeat(leading)

    // if/else if/else
    if (stripped.startsWith('if ') && stripped.endsWith('{')) {
      let condition = stripped.slice(3, -1).trim()
      if (condition.startsWith('(')) condition = condition.slice(1)
      if (condition.endsWith(')')) condition = condition.slice(0, -1)
      result.push(`${indent}if ${condition}:`)
      continue
    } else if (stripped.startsWith('} else if ') || stripped.startsWith('else if ')) {
      let condition = stripped.replace('} else if ', '').replace('else if ', '')
      condition = condition.slice(0, -1).trim()
      if (condition.startsWith('(')) condition = condition.slice(1)
      if (condition.endsWith(')')) condition = condition.slice(0, -1)
      result.push(`${indent}elif ${condition}:`)
      continue
    } else if (stripped === '} else {' || stripped === 'else {') {
      result.push(`${indent}else:`)
      continue
    } else if (stripped === '}') {
      continue
    }

    // return statements
    if (stripped.startsWith('return ')) {
      const value = stripped.slice(7).replace(/;$/, '')
      result.push(`${indent}__return__ = ${value}`)
      continue
    }

    // Remove semicolons
    let processedLine = line
    if (stripped.endsWith(';')) {
      processedLine = line.trimEnd().slice(0, -1)
    }

    result.push(processedLine)
  }

  return result.join('\n')
}

// Type for export workflow state structure - flexible to accept various workflow shapes
export interface ExportWorkflowState {
  state?: {
    blocks?: Record<string, {
      type: string
      subBlocks?: {
        code?: { value?: string }
        language?: { value?: string }
        [key: string]: unknown
      }
      [key: string]: unknown
    }>
    [key: string]: unknown
  }
  blocks?: Record<string, {
    type: string
    subBlocks?: {
      code?: { value?: string }
      language?: { value?: string }
      [key: string]: unknown
    }
    [key: string]: unknown
  }>
  [key: string]: unknown
}

/**
 * Pre-transpile all JavaScript function blocks in a workflow state to Python.
 * Handles both nested structure {state: {blocks}} and flat structure {blocks}.
 */
export function preTranspileWorkflow<T extends Record<string, unknown>>(exportState: T): T {
  // Handle ExportWorkflowState structure - cast to access properties
  const state = exportState as ExportWorkflowState
  const blocks = state?.state?.blocks ?? state?.blocks
  if (!blocks) return exportState

  for (const blockId of Object.keys(blocks)) {
    const block = blocks[blockId]
    if (block.type === 'function') {
      const codeSubBlock = block.subBlocks?.code
      const langSubBlock = block.subBlocks?.language

      if (codeSubBlock?.value && langSubBlock?.value === 'javascript') {
        // Transpile JavaScript to Python
        codeSubBlock.value = transpileJsToPython(codeSubBlock.value)
        // Update language to python
        langSubBlock.value = 'python'
      }
    }
  }

  return exportState
}
