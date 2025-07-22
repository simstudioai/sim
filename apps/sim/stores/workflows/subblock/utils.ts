// DEPRECATED: useEnvironmentStore import removed as autofill functions were removed

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
