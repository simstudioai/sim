function makeCanonicalPlaceholdersJsonParseable(value: string): string {
  let result = ''
  let inString = false
  let escaped = false

  for (let index = 0; index < value.length; index++) {
    const character = value[index]
    if (inString) {
      result += character
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }

    if (character === '"') {
      inString = true
      result += character
      continue
    }

    if (character === '{' && value[index + 1] === '{') {
      const end = value.indexOf('}}', index + 2)
      if (end !== -1) {
        const placeholder = value.slice(index, end + 2)
        const name = value.slice(index + 2, end).trim()
        if (/^[A-Za-z0-9_]+$/.test(name)) {
          result += JSON.stringify(placeholder)
          index = end + 1
          continue
        }
      }
    }

    result += character
  }

  return result
}

function canonicalPlaceholder(value: string): string | undefined {
  const match = /^\{\{([^{}]+)\}\}$/.exec(value.trim())
  if (!match || !/^[A-Za-z0-9_]+$/.test(match[1].trim())) return undefined
  return value.trim()
}

function projectStructuredLeaves(value: unknown, placeholder: string): unknown {
  if (value === null || typeof value !== 'object') return placeholder

  const projectedRoot: unknown[] | Record<string, unknown> = Array.isArray(value) ? [] : {}
  const pending: Array<{
    source: unknown[] | Record<string, unknown>
    target: unknown[] | Record<string, unknown>
  }> = [{ source: value as unknown[] | Record<string, unknown>, target: projectedRoot }]

  while (pending.length > 0) {
    const { source, target } = pending.pop()!
    for (const [key, child] of Object.entries(source)) {
      if (child !== null && typeof child === 'object') {
        const projectedChild: unknown[] | Record<string, unknown> = Array.isArray(child) ? [] : {}
        ;(target as Record<string, unknown>)[key] = projectedChild
        pending.push({
          source: child as unknown[] | Record<string, unknown>,
          target: projectedChild,
        })
      } else {
        ;(target as Record<string, unknown>)[key] = placeholder
      }
    }
  }

  return projectedRoot
}

function projectFileReferenceString(
  key: string,
  value: string,
  placeholder: string
): string | undefined {
  if (key !== 'key' && key !== 'path' && key !== 'url' && key !== 'base64') return undefined
  if ((key === 'url' || key === 'path') && value.startsWith('https://')) {
    return `https://${placeholder}`
  }
  if ((key === 'url' || key === 'path') && value.startsWith('http://')) {
    return `http://${placeholder}`
  }
  if (key === 'path' && value.startsWith('/')) return `/${placeholder}`
  return placeholder
}

function isFileDescriptor(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0 && value.every(isFileDescriptor)
  return (
    value !== null &&
    typeof value === 'object' &&
    ['key', 'path', 'url'].some(
      (key) => typeof (value as Record<string, unknown>)[key] === 'string'
    )
  )
}

function projectFileReferenceLeaves(
  value: unknown,
  placeholder: string
): { value: unknown; projectedReferences: number } | undefined {
  if (!isFileDescriptor(value)) return undefined

  const projectedRoot: unknown[] | Record<string, unknown> = Array.isArray(value) ? [] : {}
  const pending: Array<{
    source: unknown[] | Record<string, unknown>
    target: unknown[] | Record<string, unknown>
  }> = [{ source: value as unknown[] | Record<string, unknown>, target: projectedRoot }]
  let projectedReferences = 0
  while (pending.length > 0) {
    const { source, target } = pending.pop()!
    for (const [key, child] of Object.entries(source)) {
      if (child !== null && typeof child === 'object') {
        const projectedChild: unknown[] | Record<string, unknown> = Array.isArray(child) ? [] : {}
        ;(target as Record<string, unknown>)[key] = projectedChild
        pending.push({
          source: child as unknown[] | Record<string, unknown>,
          target: projectedChild,
        })
        continue
      }

      const projectedReference =
        typeof child === 'string' ? projectFileReferenceString(key, child, placeholder) : undefined
      ;(target as Record<string, unknown>)[key] = projectedReference ?? child
      if (projectedReference !== undefined) projectedReferences += 1
    }
  }
  return { value: projectedRoot, projectedReferences }
}

/**
 * Makes only schema-declared structured inputs parseable on a private placeholder projection.
 * Raw execution inputs are never passed to or changed by this helper.
 */
export function prepareResolvedSecretProjectedInputs(
  inputs: Record<string, unknown>,
  inputSchemas: Record<string, unknown> | undefined,
  rawInputs?: Record<string, unknown>,
  options: { preserveFileDescriptorGrammar?: boolean } = {}
): Record<string, unknown> {
  if (!inputSchemas) return inputs
  const prepared = { ...inputs }
  for (const [key, inputSchema] of Object.entries(inputSchemas)) {
    const inputType =
      inputSchema && typeof inputSchema === 'object'
        ? (inputSchema as { type?: unknown }).type
        : inputSchema
    if (inputType !== 'json' && inputType !== 'array') continue
    const value = prepared[key]
    if (typeof value === 'string') {
      const placeholder = canonicalPlaceholder(value)
      const rawValue = rawInputs?.[key]
      if (placeholder && typeof rawValue === 'string') {
        try {
          const parsedRawValue = JSON.parse(rawValue.trim())
          if (parsedRawValue !== null && typeof parsedRawValue === 'object') {
            const fileProjection = options.preserveFileDescriptorGrammar
              ? projectFileReferenceLeaves(parsedRawValue, placeholder)
              : undefined
            prepared[key] = JSON.stringify(
              fileProjection && fileProjection.projectedReferences > 0
                ? fileProjection.value
                : projectStructuredLeaves(parsedRawValue, placeholder)
            )
            continue
          }
        } catch {}
      }
      prepared[key] = makeCanonicalPlaceholdersJsonParseable(value)
    }
  }
  return prepared
}
