function containsDangerousOperator(value: unknown, dangerousOperators: string[]): boolean {
  if (typeof value !== 'object' || value === null) return false

  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (dangerousOperators.includes(key)) return true
    if (
      typeof record[key] === 'object' &&
      containsDangerousOperator(record[key], dangerousOperators)
    ) {
      return true
    }
  }
  return false
}

export function validateMongodbFilter(filter: string): { isValid: boolean; error?: string } {
  try {
    const parsed: unknown = JSON.parse(filter)
    const dangerousOperators = ['$where', '$regex', '$expr', '$function', '$accumulator', '$let']

    if (containsDangerousOperator(parsed, dangerousOperators)) {
      return {
        isValid: false,
        error: 'Filter contains potentially dangerous operators',
      }
    }

    return { isValid: true }
  } catch {
    return {
      isValid: false,
      error: 'Invalid JSON format in filter',
    }
  }
}

export function validateMongodbPipeline(pipeline: string): { isValid: boolean; error?: string } {
  try {
    const parsed: unknown = JSON.parse(pipeline)

    if (!Array.isArray(parsed)) {
      return {
        isValid: false,
        error: 'Pipeline must be an array',
      }
    }

    const dangerousOperators = [
      '$where',
      '$function',
      '$accumulator',
      '$let',
      '$merge',
      '$out',
      '$currentOp',
      '$listSessions',
      '$listLocalSessions',
    ]

    for (const stage of parsed) {
      if (containsDangerousOperator(stage, dangerousOperators)) {
        return {
          isValid: false,
          error: 'Pipeline contains potentially dangerous operators',
        }
      }
    }

    return { isValid: true }
  } catch {
    return {
      isValid: false,
      error: 'Invalid JSON format in pipeline',
    }
  }
}

export function sanitizeMongodbCollectionName(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(
      'Invalid collection name. Must start with letter or underscore and contain only letters, numbers, and underscores.'
    )
  }
  return name
}
