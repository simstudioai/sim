function getJsonParseErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function parseIncidentioJsonParam(
  jsonString: string | undefined,
  paramName: string,
  defaultValue: unknown
): unknown {
  if (jsonString === undefined || jsonString === '') return defaultValue

  try {
    return JSON.parse(jsonString)
  } catch (error) {
    throw new Error(`Invalid JSON for ${paramName}: ${getJsonParseErrorMessage(error)}`)
  }
}

export function parseRequiredIncidentioJsonParam(
  jsonString: string | undefined,
  paramName: string
): unknown {
  if (jsonString === undefined || jsonString === '') {
    throw new Error(`Missing required JSON for ${paramName}`)
  }

  return parseIncidentioJsonParam(jsonString, paramName, undefined)
}
