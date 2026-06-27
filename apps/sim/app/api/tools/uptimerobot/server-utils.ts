import type { Logger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { processFilesToUserFiles, type RawFileInput } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import { mapPsp, UPTIMEROBOT_API_BASE } from '@/tools/uptimerobot/types'

/** Fields shared by the PSP create and update routes (before the files). */
interface PspFormFields {
  friendlyName?: string | null
  monitorIds?: string | null
  status?: string | null
  password?: string | null
  customDomain?: string | null
  hideUrlLinks?: boolean | null
  noIndex?: boolean | null
  logo?: unknown
  icon?: unknown
}

/**
 * Appends a single optional image file (logo or icon) to the form after
 * downloading it from storage and verifying the caller may access it.
 *
 * @returns an error `NextResponse` if the file is invalid or access is denied,
 * otherwise `null`.
 */
async function appendPspImage(
  form: FormData,
  field: 'logo' | 'icon',
  file: unknown,
  userId: string,
  requestId: string,
  logger: Logger
): Promise<NextResponse | null> {
  const userFiles = processFilesToUserFiles([file as RawFileInput], requestId, logger)
  if (userFiles.length === 0) {
    // A file was supplied but could not be resolved to a stored UserFile (e.g. a
    // bare string reference). Surface it rather than silently dropping the image.
    return NextResponse.json(
      { success: false, error: `Invalid ${field} file: expected an uploaded file reference` },
      { status: 400 }
    )
  }

  const userFile = userFiles[0]
  const denied = await assertToolFileAccess(userFile.key, userId, requestId, logger)
  if (denied) return denied

  const buffer = await downloadFileFromStorage(userFile, requestId, logger)
  const mimeType = userFile.type || 'application/octet-stream'
  form.append(field, new Blob([new Uint8Array(buffer)], { type: mimeType }), userFile.name)
  return null
}

/**
 * Builds the multipart form for a PSP request, downloads any referenced
 * logo/icon files, forwards the request to UptimeRobot, and returns a typed
 * `{ success, output: { psp } }` envelope as a `NextResponse`.
 */
export async function forwardPspRequest(options: {
  apiKey: string
  method: 'POST' | 'PATCH'
  path: string
  fields: PspFormFields
  userId: string
  requestId: string
  logger: Logger
}): Promise<NextResponse> {
  const { apiKey, method, path, fields, userId, requestId, logger } = options

  const form = new FormData()
  if (fields.friendlyName) form.append('friendlyName', fields.friendlyName)
  if (fields.status) form.append('status', fields.status)
  if (fields.password) form.append('password', fields.password)
  if (fields.customDomain) form.append('customDomain', fields.customDomain)
  if (typeof fields.hideUrlLinks === 'boolean') {
    form.append('hideUrlLinks', String(fields.hideUrlLinks))
  }
  if (typeof fields.noIndex === 'boolean') form.append('noIndex', String(fields.noIndex))
  if (fields.monitorIds) {
    for (const id of fields.monitorIds.split(',')) {
      const trimmed = id.trim()
      if (trimmed) form.append('monitorIds', trimmed)
    }
  }

  if (fields.logo) {
    const denied = await appendPspImage(form, 'logo', fields.logo, userId, requestId, logger)
    if (denied) return denied
  }
  if (fields.icon) {
    const denied = await appendPspImage(form, 'icon', fields.icon, userId, requestId, logger)
    if (denied) return denied
  }

  const response = await fetch(`${UPTIMEROBOT_API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    body: form,
  })

  const text = await response.text()
  if (!response.ok) {
    let message: string | undefined
    try {
      message = JSON.parse(text)?.message
    } catch {
      message = undefined
    }
    logger.error(`[${requestId}] UptimeRobot PSP request failed`, {
      status: response.status,
      body: text,
    })
    return NextResponse.json(
      { success: false, error: message || `UptimeRobot API error (HTTP ${response.status})` },
      { status: response.status }
    )
  }

  // A successful PSP create/update must return the PspDto object. An empty or
  // non-object body is unexpected — reject it rather than mapping a phantom PSP
  // (id: 0, empty name, null images) back to the workflow.
  if (!text) {
    logger.error(`[${requestId}] UptimeRobot returned an empty PSP response`)
    return NextResponse.json(
      { success: false, error: 'UptimeRobot returned an unexpected response' },
      { status: 502 }
    )
  }

  let data: Record<string, unknown>
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Expected a PSP object response')
    }
    data = parsed as Record<string, unknown>
  } catch {
    logger.error(`[${requestId}] UptimeRobot returned an unexpected PSP response`, { body: text })
    return NextResponse.json(
      { success: false, error: 'UptimeRobot returned an unexpected response' },
      { status: 502 }
    )
  }
  return NextResponse.json({ success: true, output: { psp: mapPsp(data) } })
}
