function stringifyValue(value: any): string {
  if (typeof value === 'string') {
    return `"${value.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
  } else if (value === null) {
    return 'null'
  } else if (typeof value === 'undefined') {
    return 'undefined'
  } else if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}

export function resolveEnvVariables(value: any, environmentVariables: Record<string, string>): any {
  if (typeof value === 'string') {
    const envMatches = value.match(/\{\{([^}]+)\}\}/g)
    if (envMatches) {
      let resolvedValue = value
      for (const match of envMatches) {
        const envKey = match.slice(2, -2)
        const envValue = environmentVariables[envKey]
        if (envValue === undefined) {
          throw new Error(`Environment variable "${envKey}" was not found.`)
        }
        resolvedValue = resolvedValue.replace(match, envValue)
      }
      return resolvedValue
    }
  } else if (Array.isArray(value)) {
    return value.map((item) => resolveEnvVariables(item, environmentVariables))
  } else if (value && typeof value === 'object') {
    return Object.entries(value).reduce(
      (acc, [k, v]) => ({ ...acc, [k]: resolveEnvVariables(v, environmentVariables) }),
      {}
    )
  }
  return value
}

export function resolveBlockReferences(
  value: string,
  blockById: Map<string, any>,
  blockByName: Map<string, any>,
  blockStates: Map<string, any>,
  blockName: string,
  blockType: string,
  workflowLoops?: Record<string, { nodes: string[] }>
): string {
  const blockMatches = value.match(/<([^>]+)>/g)
  let resolvedValue = value
  if (blockMatches) {
    for (const match of blockMatches) {
      const path = match.slice(1, -1)
      const [blockRef, ...pathParts] = path.split('.')
      let sourceBlock = blockById.get(blockRef)
      if (!sourceBlock) {
        const normalized = blockRef.toLowerCase().replace(/\s+/g, '')
        sourceBlock = blockByName.get(normalized)
      }
      if (!sourceBlock) {
        throw new Error(`Block reference "${blockRef}" was not found.`)
      }
      if (sourceBlock.enabled === false) {
        throw new Error(
          `Block "${sourceBlock.metadata?.title || sourceBlock.name}" is disabled, and block "${blockName}" depends on it.`
        )
      }
      let sourceState = blockStates.get(sourceBlock.id)
      let defaulted = false
      if (!sourceState) {
        if (workflowLoops) {
          for (const loopKey in workflowLoops) {
            const loop = workflowLoops[loopKey]
            if (loop.nodes.includes(sourceBlock.id)) {
              defaulted = true
              sourceState = {} // default to empty object
              break
            }
          }
        }
        if (!sourceState) {
          throw new Error(
            `No state found for block "${sourceBlock.metadata?.title || sourceBlock.name}" (ID: ${sourceBlock.id}).`
          )
        }
      }
      // Drill into the property path.
      let replacementValue: any = sourceState
      for (const part of pathParts) {
        if (!replacementValue || typeof replacementValue !== 'object') {
          if (defaulted) {
            replacementValue = ''
            break
          } else {
            throw new Error(`Invalid path "${part}" in "${path}" for block "${blockName}".`)
          }
        }
        replacementValue = replacementValue[part]
      }
      if (replacementValue === undefined && defaulted) {
        replacementValue = ''
      } else if (replacementValue === undefined) {
        throw new Error(
          `No value found at path "${path}" in block "${sourceBlock.metadata?.title || sourceBlock.name}".`
        )
      }
      if (replacementValue !== undefined) {
        // For condition blocks, we need to properly stringify the value
        if (blockType === 'condition') {
          resolvedValue = resolvedValue.replace(match, stringifyValue(replacementValue))
        } else {
          resolvedValue = resolvedValue.replace(
            match,
            typeof replacementValue === 'object'
              ? JSON.stringify(replacementValue)
              : String(replacementValue)
          )
        }
      }
    }
  }

  if (typeof resolvedValue === 'undefined') {
    const refRegex = /<([^>]+)>/
    const match = value.match(refRegex)
    const ref = match ? match[1] : ''
    const refParts = ref.split('.')
    const refBlockId = refParts[0]

    if (workflowLoops) {
      for (const loopKey in workflowLoops) {
        const loop = workflowLoops[loopKey]
        if (loop.nodes.includes(refBlockId)) {
          // Block exists in a loop, so return empty string instead of error
          return ''
        }
      }
    }

    throw new Error(`No state found for block "${refBlockId}" (ID: ${refBlockId})`)
  }

  return resolvedValue
}
