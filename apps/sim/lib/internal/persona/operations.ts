import { createLogger } from '@sim/logger'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { PersonaOperationError } from '@/lib/internal/persona/errors'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import type { PersonaImportAccountsResponse } from '@/tools/persona/types'
import {
  buildPersonaHeaders,
  extractPersonaErrorMessage,
  mapImporter,
  PERSONA_API_BASE,
  type PersonaResourceData,
} from '@/tools/persona/utils'

const logger = createLogger('PersonaImportAccountsOperation')
const MAX_PERSONA_RESPONSE_BYTES = 2 * 1024 * 1024

export interface PersonaImportAccountsInput {
  apiKey: string
  file: RawFileInput
}

export interface PersonaOperationContext {
  userId: string
  requestId: string
  signal?: AbortSignal
}

export async function importPersonaAccounts(
  input: PersonaImportAccountsInput,
  context: PersonaOperationContext
): Promise<PersonaImportAccountsResponse> {
  context.signal?.throwIfAborted()
  const userFile = processFilesToUserFiles([input.file], context.requestId, logger)[0]
  if (!userFile) {
    throw new PersonaOperationError('Invalid file input: a stored CSV file is required', 400)
  }
  const denied = await assertToolFileAccess(userFile.key, context.userId, context.requestId, logger)
  if (denied) throw new PersonaOperationError('File not found', denied.status)

  const resolved = await downloadServableFileFromStorage(userFile, context.requestId, logger, {
    maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
  })
  const buffer = resolved.buffer
  context.signal?.throwIfAborted()
  const response = await fetch(`${PERSONA_API_BASE}/importer/accounts`, {
    method: 'POST',
    headers: buildPersonaHeaders(input.apiKey),
    body: JSON.stringify({
      data: {
        attributes: {
          file: { data: buffer.toString('base64'), filename: userFile.name },
        },
      },
    }),
    signal: context.signal,
  })
  const data = await readResponseJsonWithLimit<{ data?: PersonaResourceData } | null>(response, {
    maxBytes: MAX_PERSONA_RESPONSE_BYTES,
    label: 'Persona import accounts response',
    signal: context.signal,
  }).catch(() => null)
  if (!response.ok) {
    throw new PersonaOperationError(
      extractPersonaErrorMessage(data, `Persona API error: ${response.statusText}`),
      response.status
    )
  }
  const importer = mapImporter(data?.data ?? {})
  if (!importer.id) {
    throw new PersonaOperationError(
      'Persona returned an unexpected response for the account import',
      502
    )
  }
  return { success: true, output: { importer } }
}
