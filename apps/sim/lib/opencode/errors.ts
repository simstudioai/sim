export interface OpenCodeRouteError {
  status: number
  message: string
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (typeof error === 'string' && error.trim()) {
    return error
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const message = error.message
    if (typeof message === 'string' && message.trim()) {
      return message
    }
  }

  return 'Unknown OpenCode error'
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle))
}

export function getOpenCodeRouteError(error: unknown, resourceName: string): OpenCodeRouteError {
  const message = getErrorMessage(error)
  const normalized = message.toLowerCase()

  if (
    includesAny(normalized, [
      'repository is required',
      'unknown opencode repository',
      'providerid is required',
    ])
  ) {
    return {
      status: 400,
      message,
    }
  }

  if (normalized.includes('credentials are not configured')) {
    return {
      status: 500,
      message: 'OpenCode credentials are not configured in the app environment.',
    }
  }

  if (
    includesAny(normalized, [
      'econnrefused',
      'enotfound',
      'fetch failed',
      'socket hang up',
      'timed out',
      'timeout',
    ])
  ) {
    return {
      status: 503,
      message:
        'OpenCode server is unreachable. Check OPENCODE_BASE_URL and the runtime network configuration.',
    }
  }

  if (includesAny(normalized, ['401', '403', 'unauthorized', 'forbidden'])) {
    return {
      status: 502,
      message:
        'OpenCode authentication failed. Align OPENCODE_SERVER_USERNAME and OPENCODE_SERVER_PASSWORD with the running OpenCode server.',
    }
  }

  return {
    status: 500,
    message: `Failed to fetch OpenCode ${resourceName}.`,
  }
}
