import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import { MicrosoftTeamsOperationError } from '@/lib/internal/microsoft-teams/errors'

const MICROSOFT_GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0'
const MICROSOFT_GRAPH_RESPONSE_MAX_BYTES = 2 * 1024 * 1024

export type MicrosoftTeamsGraphObject = Record<string, unknown>

function asObject(value: unknown): MicrosoftTeamsGraphObject {
  return isRecordLike(value) ? value : {}
}

function errorMessage(data: MicrosoftTeamsGraphObject, fallback: string): string {
  const error = asObject(data.error)
  return typeof error.message === 'string' && error.message ? error.message : fallback
}

export class MicrosoftTeamsClient {
  constructor(private readonly accessToken: string) {}

  async json(
    path: string,
    init: RequestInit,
    fallbackError: string,
    signal?: AbortSignal
  ): Promise<MicrosoftTeamsGraphObject> {
    signal?.throwIfAborted()
    const response = await fetch(`${MICROSOFT_GRAPH_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...init.headers,
      },
      signal,
    })
    const text = await readResponseTextWithLimit(response, {
      maxBytes: MICROSOFT_GRAPH_RESPONSE_MAX_BYTES,
      label: 'Microsoft Graph response',
      signal,
    })
    signal?.throwIfAborted()

    let data: MicrosoftTeamsGraphObject
    try {
      data = text ? asObject(JSON.parse(text)) : {}
    } catch (error) {
      if (!response.ok) throw new MicrosoftTeamsOperationError(fallbackError, response.status)
      throw new Error(getErrorMessage(error, 'Microsoft Graph returned invalid JSON'))
    }
    if (!response.ok) {
      throw new MicrosoftTeamsOperationError(errorMessage(data, fallbackError), response.status)
    }
    return data
  }
}
