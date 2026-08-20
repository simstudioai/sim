import { useEnvironmentStore } from '../../settings/environment/store'

/**
 * Checks if a value is an environment variable reference in the format {{ENV_VAR}}
 */
export const isEnvVarReference = (value: string): boolean => {
  // Check if the value looks like {{ENV_VAR}}
  return /^\{\{[a-zA-Z0-9_-]+\}\}$/.test(value)
}

/**
 * Extracts the environment variable name from a reference like {{ENV_VAR}}
 */
export const extractEnvVarName = (value: string): string | null => {
  if (!isEnvVarReference(value)) return null
  return value.slice(2, -2)
}

/**
 * Generates possible environment variable names for a tool ID
 * For example, "exa-search" could map to "EXA_API_KEY", "EXA_KEY", etc.
 */
export const generatePossibleEnvVarNames = (toolId: string): string[] => {
  // Extract base tool name if it's a compound ID
  const baseTool = toolId.includes('-') ? toolId.split('-')[0] : toolId
  const toolPrefix = baseTool.toUpperCase()

  return [
    `${toolPrefix}_API_KEY`,
    `${toolPrefix.replace(/-/g, '_')}_API_KEY`,
    `${toolPrefix}_KEY`,
    `${toolPrefix}_TOKEN`,
    `${toolPrefix}`,
  ]
}

/**
 * Finds a matching environment variable for a tool ID
 */
export const findMatchingEnvVar = (toolId: string): string | null => {
  const envStore = useEnvironmentStore.getState()
  const possibleVars = generatePossibleEnvVarNames(toolId)

  for (const varName of possibleVars) {
    const envValue = envStore.getVariable(varName)
    if (envValue) {
      return varName
    }
  }

  return null
}
