import type { RabbitmqHealthCheckParams, RabbitmqHealthCheckResponse } from '@/tools/rabbitmq/types'
import {
  buildAuthHeaders,
  buildManagementUrl,
  extractErrorMessage,
  RABBITMQ_CONNECTION_PARAMS,
} from '@/tools/rabbitmq/utils'
import type { ToolConfig } from '@/tools/types'

const CHECKS = new Set([
  'alarms',
  'local-alarms',
  'virtual-hosts',
  'node-is-quorum-critical',
  'port-listener',
  'protocol-listener',
  'certificate-expiration',
])

const EXPIRY_UNITS = new Set(['days', 'weeks', 'months', 'years'])

function resolveCheck(check: string | undefined): string {
  return CHECKS.has(check ?? '') ? (check as string) : 'alarms'
}

/** Builds the trailing path segments for the checks that take arguments. */
function checkSegments({
  check: requestedCheck,
  port,
  protocol,
  within,
  unit,
}: Omit<RabbitmqHealthCheckParams, 'host' | 'username' | 'password' | 'vhost'>): string[] {
  const check = resolveCheck(requestedCheck)

  if (check === 'port-listener') {
    if (port === undefined) {
      throw new Error('port is required for the port-listener health check')
    }
    return [check, String(port)]
  }

  if (check === 'protocol-listener') {
    if (!protocol?.trim()) {
      throw new Error('protocol is required for the protocol-listener health check')
    }
    return [check, protocol]
  }

  if (check === 'certificate-expiration') {
    if (within === undefined) {
      throw new Error('within is required for the certificate-expiration health check')
    }
    return [check, String(within), EXPIRY_UNITS.has(unit ?? '') ? (unit as string) : 'months']
  }

  return [check]
}

export const rabbitmqHealthCheckTool: ToolConfig<
  RabbitmqHealthCheckParams,
  RabbitmqHealthCheckResponse
> = {
  id: 'rabbitmq_health_check',
  name: 'RabbitMQ Health Check',
  description:
    'Run one of the broker health checks and report whether it passed. A failing check is a normal result, not a tool error.',
  version: '1.0.0',

  params: {
    ...RABBITMQ_CONNECTION_PARAMS,
    check: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Which check to run: alarms (cluster-wide resource alarms, default), local-alarms, virtual-hosts, node-is-quorum-critical, port-listener, protocol-listener, or certificate-expiration',
    },
    port: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Port to verify a listener on. Required for the port-listener check',
    },
    protocol: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Protocol to verify a listener for, e.g. amqp, amqp/ssl, mqtt, stomp, or http. Required for the protocol-listener check',
    },
    within: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'How far ahead to look for expiring certificates. Required for the certificate-expiration check',
    },
    unit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Unit for the certificate-expiration window: days, weeks, months (default), or years',
    },
  },

  request: {
    url: ({ host, ...rest }) =>
      buildManagementUrl(host, ['health', 'checks', ...checkSegments(rest)]),
    method: 'GET',
    headers: ({ username, password }) => buildAuthHeaders(username, password),
    stripAuthOnRedirect: true,
  },

  /**
   * A failed health check answers with HTTP 503 and a body explaining why. That is a meaningful
   * answer to the question the caller asked, so it is reported as a successful call with
   * `healthy: false` rather than a tool error. Genuine transport and auth failures — anything
   * that is not 200 or 503 — still surface as errors.
   */
  transformResponse: async (response, params) => {
    const check = resolveCheck(params?.check)

    if (!response.ok && response.status !== 503) {
      const error = await extractErrorMessage(response)
      return {
        success: false,
        output: { check, healthy: false, status: 'unknown', reason: null, details: {} },
        error,
      }
    }

    const data = await response.json()
    const status = typeof data?.status === 'string' ? data.status : 'unknown'

    return {
      success: true,
      output: {
        check,
        healthy: status === 'ok',
        status,
        reason: typeof data?.reason === 'string' ? data.reason : null,
        details: typeof data === 'object' && data !== null ? data : {},
      },
    }
  },

  outputs: {
    check: { type: 'string', description: 'The health check that was run' },
    healthy: { type: 'boolean', description: 'True when the check reported status ok' },
    status: { type: 'string', description: 'Raw status reported by the broker: ok or failed' },
    reason: {
      type: 'string',
      description: 'Explanation the broker gave, present on failures and on some passes',
      optional: true,
    },
    details: {
      type: 'json',
      description:
        'Full check body, including check-specific fields such as the ports or protocols found',
    },
  },
}
