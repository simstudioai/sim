import {
  ACCESS_TOKEN_PARAM,
  CREDENTIAL_PARAM,
  SESSION_ID_PARAM,
} from '@/tools/managed_agent/shared'
import type {
  ManagedAgentUpdateSessionParams,
  ManagedAgentUpdateSessionResponse,
} from '@/tools/managed_agent/types'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

/**
 * Updates an existing session's title and/or metadata.
 *
 * Metadata is settable at create time too, but some of what you want to store
 * only exists AFTER the session does — the canonical case is writing back the
 * id of a message/thread that was posted to announce the session. This closes
 * that ordering gap.
 *
 * Metadata is a FULL REPLACEMENT of the stored map, matching the API. To add
 * one key, read the session first and send the merged map. Removing metadata
 * entirely takes an explicit `clearMetadata`, because an empty map is
 * indistinguishable from a field the author never filled in.
 */

export const managedAgentUpdateSessionTool: InternalToolConfig<
  ManagedAgentUpdateSessionParams,
  ManagedAgentUpdateSessionResponse
> = {
  id: 'managed_agent_update_session',
  name: 'Managed Agent Update Session',
  description: "Update a Managed Agent session's title or metadata.",
  version: '1.0.0',

  params: {
    credential: CREDENTIAL_PARAM,
    accessToken: ACCESS_TOKEN_PARAM,
    sessionId: SESSION_ID_PARAM,
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New session title.',
    },
    sessionParameters: {
      type: 'object',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Replacement metadata map (replaces all stored metadata, not merged). Leaving it empty leaves the stored metadata unchanged — use clearMetadata to remove it.',
    },
    clearMetadata: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        "Removes all of the session's stored metadata. Overrides any map supplied above.",
    },
  },

  operation: {
    input: createInternalToolOperationInput,
  },

  outputs: {
    sessionId: { type: 'string', description: 'The session that was updated.' },
    updated: { type: 'boolean', description: 'True when the update was accepted.' },
    metadata: { type: 'json', description: 'Metadata after the update.', optional: true },
    title: { type: 'string', description: 'Title after the update.', optional: true },
  },
}
