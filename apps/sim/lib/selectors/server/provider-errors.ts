export interface SelectorProviderFailure {
  error: string
  status: number
  authRequired?: true
}

export type SelectorAtlassianProvider =
  | 'Atlassian'
  | 'Jira'
  | 'Confluence'
  | 'Jira Service Management'

/** Keeps provider-controlled discovery bodies out of selector errors and retry logs. */
export const SELECTOR_ATLASSIAN_DISCOVERY_OPTIONS = {
  omitResponseBodyFromErrors: true,
} as const

function providerStatusFromError(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined
  const status = error.status
  return typeof status === 'number' && Number.isInteger(status) ? status : undefined
}

/** Maps provider failures to stable selector-safe responses without reading response bodies. */
export function selectorProviderFailure(
  provider: SelectorAtlassianProvider,
  status: number
): SelectorProviderFailure {
  if (status === 401) {
    return {
      error: `${provider} rejected this credential. Reconnect it and try again.`,
      status: 401,
      authRequired: true,
    }
  }
  if (status === 403) {
    return { error: `${provider} denied selector access.`, status: 403 }
  }
  if (status === 429) {
    return { error: `${provider} rate-limited selector discovery. Try again shortly.`, status: 429 }
  }
  return { error: `${provider} selector discovery failed.`, status: 502 }
}

export type SelectorProviderValueResult<T> =
  | { ok: true; value: T }
  | {
      ok: false
      failure: SelectorProviderFailure
      upstreamStatus?: number
    }

/** Converts provider discovery exceptions into a safe value boundary. */
export async function resolveSelectorProviderValue<T>(
  provider: SelectorAtlassianProvider,
  resolve: () => Promise<T>
): Promise<SelectorProviderValueResult<T>> {
  try {
    return { ok: true, value: await resolve() }
  } catch (error) {
    const upstreamStatus = providerStatusFromError(error)
    return {
      ok: false,
      failure: selectorProviderFailure(provider, upstreamStatus ?? 502),
      upstreamStatus,
    }
  }
}
