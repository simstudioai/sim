import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type { OktaGetLogsParams, OktaGetLogsResponse, OktaLogEvent } from '@/tools/okta/types'
import { oktaHeaders, parseOktaPagination, throwOktaError } from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaGetLogs')

export const oktaGetLogsTool: ToolConfig<OktaGetLogsParams, OktaGetLogsResponse> = {
  id: 'okta_get_logs',
  name: 'Get System Log Events from Okta',
  description:
    'Query the Okta System Log for sign-ins, admin changes, and security events. Supports a time window, SCIM filter expressions, keyword search, and cursor pagination for audit and investigation workflows.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Okta API token for authentication',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Okta domain (e.g., dev-123456.okta.com)',
    },
    since: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Start of the query time window as an ISO 8601 timestamp (default: 7 days before "until"). Ignored when a cursor is supplied in "after", which already encodes the resume position',
    },
    until: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End of the query time window as an ISO 8601 timestamp (default: now)',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'SCIM filter expression (e.g., eventType eq "user.session.start" or outcome.result eq "FAILURE")',
    },
    q: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Keyword search across the event payload (max 40 characters per keyword, max 10 keywords)',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: ASCENDING (default) or DESCENDING',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque pagination cursor returned as nextCursor by a previous call',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of events to return (default: 100, max: 1000)',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      const queryParams = new URLSearchParams()

      /**
       * Okta documents `since` and `after` as mutually exclusive. A cursor
       * already encodes the position it resumes from, so it wins over the
       * window start whenever both are supplied — otherwise a scheduled poll
       * that has both configured would send a request Okta rejects.
       */
      if (params.after) queryParams.append('after', params.after)
      else if (params.since) queryParams.append('since', params.since)
      if (params.until) queryParams.append('until', params.until)
      if (params.filter) queryParams.append('filter', params.filter)
      if (params.q) queryParams.append('q', params.q)
      if (params.sortOrder) queryParams.append('sortOrder', params.sortOrder)
      /** `0` is a documented limit on this endpoint, so it must not read as absent. */
      if (params.limit !== undefined && params.limit !== null) {
        queryParams.append('limit', params.limit.toString())
      }

      const queryString = queryParams.toString()
      return queryString
        ? `https://${domain}/api/v1/logs?${queryString}`
        : `https://${domain}/api/v1/logs`
    },
    method: 'GET',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to get System Log events from Okta')
    }

    const { nextCursor, hasMore } = parseOktaPagination(response)
    const data: OktaLogEvent[] = await response.json()

    /**
     * The System Log runs two pagination regimes, and only this endpoint does.
     *
     * A bounded query (one with `until`) drops the `rel="next"` link on its last
     * page, so the shared `Link` parser is enough. A polling query — no `until`,
     * which is this tool's default shape — always advertises a next link "even
     * if there are no new events", so `hasMore` would be permanently true and
     * any loop driven by it would never terminate. An empty page ends both
     * regimes, so emptiness is the terminating signal.
     *
     * `hasMore` and `nextCursor` answer different questions and so diverge on an
     * empty polling page: `hasMore` is "fetch again now" and turns false, while
     * `nextCursor` is the resume handle Okta tells callers to persist and re-poll
     * later. Nulling the handle would make a scheduled workflow that hits one
     * quiet interval restart from `since` and re-deliver events it already saw.
     */
    const moreAvailable = hasMore && data.length > 0

    const events = data.map((event) => ({
      uuid: event.uuid,
      published: event.published,
      eventType: event.eventType,
      severity: event.severity,
      legacyEventType: event.legacyEventType ?? null,
      displayMessage: event.displayMessage ?? null,
      outcomeResult: event.outcome?.result ?? null,
      outcomeReason: event.outcome?.reason ?? null,
      actorId: event.actor?.id ?? null,
      actorType: event.actor?.type ?? null,
      actorAlternateId: event.actor?.alternateId ?? null,
      actorDisplayName: event.actor?.displayName ?? null,
      clientIpAddress: event.client?.ipAddress ?? null,
      clientDevice: event.client?.device ?? null,
      clientZone: event.client?.zone ?? null,
      clientBrowser: event.client?.userAgent?.browser ?? null,
      clientOs: event.client?.userAgent?.os ?? null,
      clientCity: event.client?.geographicalContext?.city ?? null,
      clientState: event.client?.geographicalContext?.state ?? null,
      clientCountry: event.client?.geographicalContext?.country ?? null,
      authenticationProvider: event.authenticationContext?.authenticationProvider ?? null,
      credentialType: event.authenticationContext?.credentialType ?? null,
      externalSessionId: event.authenticationContext?.externalSessionId ?? null,
      securityAsOrg: event.securityContext?.asOrg ?? null,
      securityIsp: event.securityContext?.isp ?? null,
      securityIsProxy: event.securityContext?.isProxy ?? null,
      transactionId: event.transaction?.id ?? null,
      transactionType: event.transaction?.type ?? null,
      targets: (event.target ?? []).map((target) => ({
        id: target.id ?? null,
        type: target.type ?? null,
        alternateId: target.alternateId ?? null,
        displayName: target.displayName ?? null,
      })),
      debugData: event.debugContext?.debugData ?? null,
    }))

    return {
      success: true,
      output: {
        events,
        count: events.length,
        nextCursor,
        hasMore: moreAvailable,
        success: true,
      },
    }
  },

  outputs: {
    events: {
      type: 'array',
      description: 'Array of System Log events',
      items: {
        type: 'object',
        properties: {
          uuid: { type: 'string', description: 'Unique event ID' },
          published: { type: 'string', description: 'Event timestamp' },
          eventType: {
            type: 'string',
            description: 'Event type (e.g., user.session.start, user.account.update_password)',
          },
          severity: { type: 'string', description: 'Event severity (DEBUG, ERROR, INFO, WARN)' },
          legacyEventType: { type: 'string', description: 'Legacy event type', optional: true },
          displayMessage: {
            type: 'string',
            description: 'Human-readable event description',
            optional: true,
          },
          outcomeResult: {
            type: 'string',
            description: 'Event outcome (SUCCESS, FAILURE, CHALLENGE, DENY, etc.)',
            optional: true,
          },
          outcomeReason: { type: 'string', description: 'Reason for the outcome', optional: true },
          actorId: { type: 'string', description: 'ID of the actor', optional: true },
          actorType: {
            type: 'string',
            description: 'Actor type (User, Client, etc.)',
            optional: true,
          },
          actorAlternateId: {
            type: 'string',
            description: 'Actor alternate ID, usually the login',
            optional: true,
          },
          actorDisplayName: { type: 'string', description: 'Actor display name', optional: true },
          clientIpAddress: { type: 'string', description: 'Client IP address', optional: true },
          clientDevice: {
            type: 'string',
            description: 'Client device category (e.g., Computer)',
            optional: true,
          },
          clientZone: { type: 'string', description: 'Network zone', optional: true },
          clientBrowser: { type: 'string', description: 'Client browser', optional: true },
          clientOs: { type: 'string', description: 'Client operating system', optional: true },
          clientCity: { type: 'string', description: 'Client city', optional: true },
          clientState: { type: 'string', description: 'Client state or region', optional: true },
          clientCountry: { type: 'string', description: 'Client country', optional: true },
          authenticationProvider: {
            type: 'string',
            description: 'Authentication provider used',
            optional: true,
          },
          credentialType: { type: 'string', description: 'Credential type used', optional: true },
          externalSessionId: {
            type: 'string',
            description: 'External session ID for correlating events',
            optional: true,
          },
          securityAsOrg: {
            type: 'string',
            description: 'Autonomous system organization',
            optional: true,
          },
          securityIsp: { type: 'string', description: 'Internet service provider', optional: true },
          securityIsProxy: {
            type: 'boolean',
            description: 'Whether the request came through a proxy',
            optional: true,
          },
          transactionId: { type: 'string', description: 'Transaction ID', optional: true },
          transactionType: {
            type: 'string',
            description: 'Transaction type (e.g., WEB, JOB)',
            optional: true,
          },
          targets: {
            type: 'array',
            description: 'Entities the event acted upon',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Target ID', optional: true },
                type: { type: 'string', description: 'Target type', optional: true },
                alternateId: { type: 'string', description: 'Target alternate ID', optional: true },
                displayName: { type: 'string', description: 'Target display name', optional: true },
              },
            },
          },
          debugData: {
            type: 'json',
            description:
              'Extra context whose keys depend on the event type. Okta states these keys and values can change between releases, so treat them as a debugging aid rather than a contract',
            optional: true,
          },
        },
      },
    },
    count: { type: 'number', description: 'Number of events returned' },
    nextCursor: {
      type: 'string',
      description:
        'Cursor to resume from, or null when Okta advertised no next link. On a polling query it stays set on an empty page so the next scheduled run resumes from here rather than replaying from the start',
      optional: true,
    },
    hasMore: {
      type: 'boolean',
      description:
        'Whether more events are available. A query with no "until" is a polling query, which Okta always answers with a next link even when there are no new events, so this reports false once a page comes back empty',
    },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
