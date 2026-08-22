import type { ToolConfig } from '@/tools/types'

/**
 * Params every Photon tool shares. Credentials are user-only; the block collects them once and
 * every operation forwards them to the internal route.
 */
export const photonCredentialParams = {
  projectId: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Photon project ID from app.photon.codes',
  },
  projectSecret: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Photon project secret from app.photon.codes',
  },
} as const satisfies ToolConfig['params']

export const photonChatTargetParams = {
  to: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Where to send: a phone number in E.164 form (e.g. +14155551234), an Apple ID email, or a chat ID from an iMessage trigger. A chat ID is the only way to reach a group chat.',
  },
} as const satisfies ToolConfig['params']

/**
 * Parse an internal-route response into the uniform `{ success, output }` contract. Routes always
 * return JSON with a `success` flag; a falsy flag carries the human-readable error.
 */
export async function parsePhotonResponse<TOutput>(
  response: Response,
  fallbackError: string,
  zeroOutput: TOutput,
  pick: (output: Record<string, unknown>) => TOutput
): Promise<{ success: boolean; output: TOutput; error?: string }> {
  const data = (await response.json().catch(() => null)) as {
    success?: boolean
    output?: Record<string, unknown>
    error?: string
  } | null

  if (!data?.success) {
    return {
      success: false,
      error: data?.error || fallbackError,
      output: zeroOutput,
    }
  }

  return { success: true, output: pick(data.output ?? {}) }
}

export const jsonHeaders = () => ({ 'Content-Type': 'application/json' })
