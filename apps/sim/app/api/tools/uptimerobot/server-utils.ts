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
 * @returns an error `NextResponse` if access is denied, otherwise `null`.
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
  if (userFiles.length === 0) return null

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

  const data = text ? JSON.parse(text) : {}
  return NextResponse.json({ success: true, output: { psp: mapPsp(data) } })
}
