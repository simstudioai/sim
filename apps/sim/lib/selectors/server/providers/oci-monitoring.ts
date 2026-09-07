import { z } from 'zod'
import { createOciClient, type OciClient } from '@/lib/internal/oci/client.server'
import { OciClientError } from '@/lib/internal/oci/errors'
import {
  type OciMonitoringOperation,
  ociMonitoringInputSchemas,
} from '@/lib/internal/oci-monitoring/input'
import { executeOciMonitoringOperation } from '@/lib/internal/oci-monitoring/operations'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import {
  definePreparedSelectorAttachment,
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'

type MonitoringSelectorKey =
  | 'oci_monitoring.namespaces'
  | 'oci_monitoring.alarms'
  | 'oci_monitoring.alarmSuppressions'

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['oci_monitoring'],
} as const
const integrationBlockTypes = ['oci_monitoring'] as const
const optionSchema = z.object({ id: z.string().min(1), displayName: z.string() })

function selectorError(error: unknown): Error {
  if (
    error instanceof OciClientError &&
    (error.code === 'credential_unavailable' || error.status === 401 || error.status === 403)
  ) {
    return new SelectorConnectionUnavailableError(error.status === 401 ? 401 : 403)
  }
  return new SelectorOptionsUnavailableError(
    error instanceof OciClientError && error.status === 429 ? 429 : 502
  )
}

async function prepareDestination(args: ExecuteServerSelectorArgs): Promise<OciClient> {
  args.signal?.throwIfAborted()
  const access = args.credential?.access
  if (!access?.ok || !access.resolvedCredentialId || access.credentialType !== 'service_account') {
    throw new SelectorConnectionUnavailableError()
  }
  try {
    return await createOciClient({
      credentialId: access.resolvedCredentialId,
      workspaceId: args.workspaceId,
      serviceId: 'oci_monitoring',
      region: args.context.region,
    })
  } catch (error) {
    args.signal?.throwIfAborted()
    throw selectorError(error)
  }
}

async function executeSelector(args: ExecuteServerSelectorArgs, client: OciClient) {
  args.signal?.throwIfAborted()
  const namespace = args.selectorKey === 'oci_monitoring.namespaces'
  const alarms = args.selectorKey === 'oci_monitoring.alarms'
  const detail = args.request.kind === 'detail'
  const compartmentId = namespace
    ? args.context.metricCompartmentId || args.context.compartmentId
    : args.context.compartmentId
  const operation: OciMonitoringOperation = namespace
    ? 'list_metrics'
    : alarms
      ? detail
        ? 'get_alarm'
        : 'list_alarms'
      : detail
        ? 'get_alarm_suppression'
        : 'list_alarm_suppressions'
  const input = {
    oauthCredential: args.credential?.access?.resolvedCredentialId,
    region: args.context.region,
    compartmentId,
    limit: 100,
    ...(args.request.kind === 'list'
      ? { page: args.request.cursor, displayName: args.request.search || undefined }
      : {}),
    ...(namespace
      ? {
          groupBy: ['namespace'],
          namespace: args.request.kind === 'detail' ? args.request.id : undefined,
        }
      : {}),
    alarmId: alarms && args.request.kind === 'detail' ? args.request.id : args.context.alarmId,
    alarmSuppressionId:
      !namespace && !alarms && args.request.kind === 'detail' ? args.request.id : undefined,
  }
  const parsed = ociMonitoringInputSchemas[operation].safeParse(input)
  if (!parsed.success) throw new SelectorContextUnavailableError()
  try {
    const result = await executeOciMonitoringOperation(client, operation, parsed.data, args.signal)
    if (!result.success) throw new SelectorOptionsUnavailableError()
    const output = result.output
    if (namespace) {
      const metrics = z.array(z.object({ namespace: z.string() })).parse(output.metrics)
      const options = [...new Set(metrics.map((metric) => metric.namespace))].map((name) => ({
        id: name,
        label: name,
      }))
      if (args.request.kind === 'detail') {
        const selectedId = args.request.id
        return detailSelectorResult(options.find((option) => option.id === selectedId) ?? null)
      }
      return listSelectorResult(
        options,
        typeof output.nextPage === 'string' ? output.nextPage : undefined
      )
    }
    if (detail) {
      if (alarms) {
        const alarm = z.object({ compartmentId: z.string() }).parse(output.alarm)
        if (alarm.compartmentId !== compartmentId) return detailSelectorResult(null)
      } else {
        const suppression = z
          .object({
            alarmSuppressionTarget: z.object({
              targetType: z.string(),
              alarmId: z.string().optional(),
            }),
          })
          .parse(output.alarmSuppression)
        if (
          suppression.alarmSuppressionTarget.targetType !== 'ALARM' ||
          suppression.alarmSuppressionTarget.alarmId !== args.context.alarmId
        ) {
          return detailSelectorResult(null)
        }
      }
      const item = optionSchema.parse(alarms ? output.alarm : output.alarmSuppression)
      return detailSelectorResult({ id: item.id, label: item.displayName })
    }
    const items = z.array(optionSchema).parse(alarms ? output.alarms : output.alarmSuppressions)
    return listSelectorResult(
      items.map((item) => ({ id: item.id, label: item.displayName })),
      typeof output.nextPage === 'string' ? output.nextPage : undefined
    )
  } catch (error) {
    args.signal?.throwIfAborted()
    if (detail && error instanceof OciClientError && error.status === 404) {
      return detailSelectorResult(null)
    }
    throw selectorError(error)
  }
}

export const ociMonitoringSelectorAttachments = {
  'oci_monitoring.namespaces': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeSelector,
  }),
  'oci_monitoring.alarms': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeSelector,
  }),
  'oci_monitoring.alarmSuppressions': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeSelector,
  }),
} satisfies ServerSelectorAttachmentMap<MonitoringSelectorKey>
