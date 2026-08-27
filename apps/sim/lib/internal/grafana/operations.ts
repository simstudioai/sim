import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import { GrafanaClient } from '@/lib/internal/grafana/client'
import type {
  GrafanaCheckDataSourceHealthInput,
  GrafanaUpdateAlertRuleInput,
  GrafanaUpdateDashboardInput,
  GrafanaUpdateFolderInput,
} from '@/lib/internal/grafana/schema'
import { mapAlertRule } from '@/tools/grafana/utils'

const logger = createLogger('GrafanaOperations')
const MAX_ERROR_MESSAGE_LENGTH = 2000

export interface GrafanaOperationContext {
  requestId: string
  signal?: AbortSignal
}

function failure(error: string, withOutput = true) {
  return withOutput
    ? { success: false as const, output: {}, error }
    : { success: false as const, error }
}

async function errorText(response: { text(): Promise<string> }): Promise<string> {
  return truncate(await response.text(), MAX_ERROR_MESSAGE_LENGTH)
}

function parseJsonField(value: string | undefined, field: string): unknown | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`Invalid JSON for ${field} parameter`)
  }
}

export async function checkGrafanaDataSourceHealth(
  input: GrafanaCheckDataSourceHealthInput,
  context: GrafanaOperationContext
) {
  try {
    const client = new GrafanaClient(
      input.baseUrl,
      input.apiKey,
      input.organizationId,
      context.signal
    )
    const result = await client.request(
      `/api/datasources/uid/${encodeURIComponent(input.dataSourceUid.trim())}/health`,
      { method: 'GET' }
    )
    if (!result.success) return failure(result.error, false)

    const raw = await result.response.text()
    let body: unknown = null
    if (raw.length > 0) {
      try {
        body = JSON.parse(raw)
      } catch {
        body = null
      }
    }
    const payload =
      body && typeof body === 'object'
        ? (body as { status?: unknown; message?: unknown; details?: unknown })
        : null
    if (payload && typeof payload.status === 'string') {
      return {
        success: true as const,
        output: {
          status: payload.status,
          message: typeof payload.message === 'string' ? payload.message : null,
          ...(payload.details === undefined ? {} : { details: payload.details }),
        },
      }
    }
    return failure(
      `Failed to check data source health: HTTP ${result.response.status} ${truncate(raw, MAX_ERROR_MESSAGE_LENGTH)}`,
      false
    )
  } catch (error) {
    context.signal?.throwIfAborted()
    logger.error('Error checking Grafana data source health', {
      requestId: context.requestId,
      error: getErrorMessage(error),
    })
    return failure(getErrorMessage(error), false)
  }
}

export async function updateGrafanaDashboard(
  input: GrafanaUpdateDashboardInput,
  context: GrafanaOperationContext
) {
  try {
    const client = new GrafanaClient(
      input.baseUrl,
      input.apiKey,
      input.organizationId,
      context.signal
    )
    const existingResult = await client.request(
      `/api/dashboards/uid/${encodeURIComponent(input.dashboardUid.trim())}`,
      { method: 'GET' }
    )
    if (!existingResult.success) return failure(existingResult.error)
    if (!existingResult.response.ok) {
      return failure(
        `Failed to fetch existing dashboard: ${await errorText(existingResult.response)}`
      )
    }
    const existing = (await existingResult.response.json()) as {
      dashboard?: Record<string, unknown>
      meta?: { folderUid?: string }
    }
    const dashboard = existing.dashboard
    if (!dashboard?.uid) return failure('Failed to fetch existing dashboard')

    const updated: Record<string, unknown> = { ...dashboard }
    if (input.title) updated.title = input.title
    if (input.timezone) updated.timezone = input.timezone
    if (input.refresh) updated.refresh = input.refresh
    if (input.tags) {
      updated.tags = input.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
    }
    const panels = parseJsonField(input.panels, 'panels')
    if (panels !== undefined) updated.panels = panels
    if (dashboard.version) updated.version = dashboard.version

    const body: Record<string, unknown> = {
      dashboard: updated,
      overwrite: input.overwrite === true,
    }
    if (input.folderUid) body.folderUid = input.folderUid
    else if (existing.meta?.folderUid) body.folderUid = existing.meta.folderUid
    if (input.message) body.message = input.message

    const updateResult = await client.request('/api/dashboards/db', { method: 'POST', body })
    if (!updateResult.success) return failure(updateResult.error)
    if (!updateResult.response.ok) {
      return failure(`Failed to update dashboard: ${await errorText(updateResult.response)}`)
    }
    const data = (await updateResult.response.json()) as Record<string, unknown>
    return {
      success: true as const,
      output: {
        id: data.id,
        uid: data.uid,
        url: data.url,
        status: data.status,
        version: data.version,
        slug: data.slug,
      },
    }
  } catch (error) {
    context.signal?.throwIfAborted()
    return failure(getErrorMessage(error))
  }
}

export async function updateGrafanaAlertRule(
  input: GrafanaUpdateAlertRuleInput,
  context: GrafanaOperationContext
) {
  try {
    const client = new GrafanaClient(
      input.baseUrl,
      input.apiKey,
      input.organizationId,
      context.signal
    )
    const path = `/api/v1/provisioning/alert-rules/${encodeURIComponent(input.alertRuleUid.trim())}`
    const existingResult = await client.request(path, { method: 'GET' })
    if (!existingResult.success) return failure(existingResult.error)
    if (!existingResult.response.ok) {
      return failure(
        `Failed to fetch existing alert rule: ${await errorText(existingResult.response)}`
      )
    }
    const existing = (await existingResult.response.json()) as Record<string, unknown>
    if (!existing.uid) return failure('Failed to fetch existing alert rule')

    const updated: Record<string, unknown> = { ...existing }
    if (input.title) updated.title = input.title
    if (input.folderUid) updated.folderUID = input.folderUid
    if (input.ruleGroup) updated.ruleGroup = input.ruleGroup
    if (input.condition) updated.condition = input.condition
    if (input.forDuration) updated.for = input.forDuration
    if (input.noDataState) updated.noDataState = input.noDataState
    if (input.execErrState) updated.execErrState = input.execErrState
    if (input.isPaused !== undefined) updated.isPaused = input.isPaused
    if (input.keepFiringFor) updated.keep_firing_for = input.keepFiringFor
    if (input.missingSeriesEvalsToResolve !== undefined) {
      updated.missingSeriesEvalsToResolve = input.missingSeriesEvalsToResolve
    }
    const replacements = [
      ['notificationSettings', 'notification_settings'],
      ['record', 'record'],
      ['data', 'data'],
    ] as const
    for (const [inputKey, outputKey] of replacements) {
      const value = parseJsonField(input[inputKey], inputKey)
      if (value !== undefined) updated[outputKey] = value
    }
    for (const key of ['annotations', 'labels'] as const) {
      const value = parseJsonField(input[key], key)
      if (value !== undefined) {
        updated[key] = {
          ...(typeof existing[key] === 'object' ? existing[key] : {}),
          ...(value as object),
        }
      }
    }

    const updateResult = await client.request(path, {
      method: 'PUT',
      body: updated,
      headers: input.disableProvenance ? { 'X-Disable-Provenance': 'true' } : undefined,
    })
    if (!updateResult.success) return failure(updateResult.error)
    if (!updateResult.response.ok) {
      return failure(`Failed to update alert rule: ${await errorText(updateResult.response)}`)
    }
    return {
      success: true as const,
      output: mapAlertRule((await updateResult.response.json()) as Record<string, unknown>),
    }
  } catch (error) {
    context.signal?.throwIfAborted()
    return failure(getErrorMessage(error))
  }
}

export async function updateGrafanaFolder(
  input: GrafanaUpdateFolderInput,
  context: GrafanaOperationContext
) {
  try {
    const client = new GrafanaClient(
      input.baseUrl,
      input.apiKey,
      input.organizationId,
      context.signal
    )
    const path = `/api/folders/${encodeURIComponent(input.folderUid.trim())}`
    const existingResult = await client.request(path, { method: 'GET' })
    if (!existingResult.success) return failure(existingResult.error)
    if (!existingResult.response.ok) {
      return failure(`Failed to fetch existing folder: ${await errorText(existingResult.response)}`)
    }
    const existing = (await existingResult.response.json()) as Record<string, unknown>
    if (!existing.uid) return failure('Failed to fetch existing folder')

    const updateResult = await client.request(path, {
      method: 'PUT',
      body: { title: input.title, version: existing.version },
    })
    if (!updateResult.success) return failure(updateResult.error)
    if (!updateResult.response.ok) {
      return failure(`Failed to update folder: ${await errorText(updateResult.response)}`)
    }
    const data = (await updateResult.response.json()) as Record<string, unknown>
    return {
      success: true as const,
      output: {
        id: (data.id as number) ?? null,
        uid: (data.uid as string) ?? null,
        title: (data.title as string) ?? null,
        url: (data.url as string) ?? null,
        parentUid: (data.parentUid as string) ?? null,
        parents: (data.parents as { uid: string; title: string; url: string }[]) ?? [],
        hasAcl: (data.hasAcl as boolean) ?? null,
        canSave: (data.canSave as boolean) ?? null,
        canEdit: (data.canEdit as boolean) ?? null,
        canAdmin: (data.canAdmin as boolean) ?? null,
        createdBy: (data.createdBy as string) ?? null,
        created: (data.created as string) ?? null,
        updatedBy: (data.updatedBy as string) ?? null,
        updated: (data.updated as string) ?? null,
        version: (data.version as number) ?? null,
      },
    }
  } catch (error) {
    context.signal?.throwIfAborted()
    return failure(getErrorMessage(error))
  }
}
