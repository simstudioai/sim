/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import * as rabbitmqTools from '@/tools/rabbitmq'
import { rabbitmqCreateBindingTool } from '@/tools/rabbitmq/create_binding'
import { rabbitmqCreatePolicyTool } from '@/tools/rabbitmq/create_policy'
import { rabbitmqDeleteBindingTool } from '@/tools/rabbitmq/delete_binding'
import { rabbitmqDeleteQueueTool } from '@/tools/rabbitmq/delete_queue'
import { rabbitmqGetMessagesTool } from '@/tools/rabbitmq/get_messages'
import { rabbitmqGetQueueTool } from '@/tools/rabbitmq/get_queue'
import { rabbitmqHealthCheckTool } from '@/tools/rabbitmq/health_check'
import { rabbitmqListQueuesTool } from '@/tools/rabbitmq/list_queues'
import { rabbitmqListVhostsTool } from '@/tools/rabbitmq/list_vhosts'
import { rabbitmqPublishMessageTool } from '@/tools/rabbitmq/publish_message'

const conn = {
  host: 'https://rabbit.example.com:15672',
  username: 'guest',
  password: 'guest',
}

function url(tool: { request: { url: unknown } }, params: Record<string, unknown>): string {
  const build = tool.request.url as (p: Record<string, unknown>) => string
  return build({ ...conn, ...params })
}

describe('rabbitmq management url building', () => {
  it('encodes the default vhost as %2F', () => {
    expect(url(rabbitmqGetQueueTool, { queue: 'orders' })).toBe(
      'https://rabbit.example.com:15672/api/queues/%2F/orders'
    )
  })

  it('encodes a named vhost and a queue name containing a slash', () => {
    expect(url(rabbitmqGetQueueTool, { vhost: 'prod/eu', queue: 'orders/new' })).toBe(
      'https://rabbit.example.com:15672/api/queues/prod%2Feu/orders%2Fnew'
    )
  })

  it('tolerates a host copied with a trailing slash or /api suffix', () => {
    const expected = 'https://rabbit.example.com:15672/api/queues/%2F/orders'
    expect(url(rabbitmqGetQueueTool, { host: `${conn.host}/`, queue: 'orders' })).toBe(expected)
    expect(url(rabbitmqGetQueueTool, { host: `${conn.host}/api`, queue: 'orders' })).toBe(expected)
    expect(url(rabbitmqGetQueueTool, { host: `${conn.host}/api/`, queue: 'orders' })).toBe(expected)
  })

  it('rejects a host that is not an http(s) URL', () => {
    expect(() => url(rabbitmqGetQueueTool, { host: 'rabbit.example.com', queue: 'q' })).toThrow(
      /Provide a full URL/
    )
    expect(() =>
      url(rabbitmqGetQueueTool, { host: 'amqp://rabbit.example.com', queue: 'q' })
    ).toThrow(/Unsupported RabbitMQ host protocol/)
  })

  it('omits delete guards that were not requested', () => {
    expect(url(rabbitmqDeleteQueueTool, { queue: 'orders' })).toBe(
      'https://rabbit.example.com:15672/api/queues/%2F/orders'
    )
    expect(url(rabbitmqDeleteQueueTool, { queue: 'orders', ifEmpty: true })).toBe(
      'https://rabbit.example.com:15672/api/queues/%2F/orders?if-empty=true'
    )
  })
})

describe('rabbitmq_publish_message', () => {
  const body = (params: Record<string, unknown>) =>
    rabbitmqPublishMessageTool.request.body?.({ ...conn, ...params } as never) as Record<
      string,
      unknown
    >

  it('merges headers into the AMQP properties', () => {
    expect(
      body({
        exchange: 'orders',
        routingKey: 'created',
        payload: 'body',
        properties: '{"delivery_mode":2,"headers":{"a":"1"}}',
        headers: '{"b":"2"}',
      })
    ).toEqual({
      properties: { delivery_mode: 2, headers: { a: '1', b: '2' } },
      routing_key: 'created',
      payload: 'body',
      payload_encoding: 'string',
    })
  })

  it('defaults to string encoding and empty properties', () => {
    expect(body({ exchange: '', routingKey: 'orders', payload: 'hi' })).toEqual({
      properties: {},
      routing_key: 'orders',
      payload: 'hi',
      payload_encoding: 'string',
    })
  })

  it('rejects properties that are not a JSON object', () => {
    expect(() =>
      body({ exchange: '', routingKey: 'q', payload: 'hi', properties: '[1,2]' })
    ).toThrow(/properties must be a JSON object/)
    expect(() => body({ exchange: '', routingKey: 'q', payload: 'hi', headers: 'nope' })).toThrow(
      /headers must be a valid JSON object/
    )
  })
})

describe('rabbitmq response handling', () => {
  it('reads the pagination envelope returned when page params are sent', async () => {
    const response = new Response(
      JSON.stringify({
        items: [{ name: 'orders', vhost: '/', messages: 3 }],
        total_count: 12,
        page: 2,
        page_count: 4,
      }),
      { status: 200 }
    )

    const result = await rabbitmqListQueuesTool.transformResponse!(response)

    expect(result.success).toBe(true)
    expect(result.output.totalCount).toBe(12)
    expect(result.output.page).toBe(2)
    expect(result.output.pageCount).toBe(4)
    expect(result.output.queues[0]).toMatchObject({ name: 'orders', messages: 3 })
  })

  it('reads a bare array from a broker that returned no envelope', async () => {
    const response = new Response(JSON.stringify([{ name: 'orders', vhost: '/' }]), { status: 200 })

    const result = await rabbitmqListQueuesTool.transformResponse!(response)

    expect(result.output.count).toBe(1)
    expect(result.output.page).toBeNull()
  })

  it('nulls queue statistics the broker has not collected yet', async () => {
    const response = new Response(
      JSON.stringify({ name: 'fresh', vhost: '/', durable: true, type: 'classic' }),
      { status: 200 }
    )

    const result = await rabbitmqGetQueueTool.transformResponse!(response)

    expect(result.output.queue).toMatchObject({
      name: 'fresh',
      durable: true,
      messages: null,
      consumers: null,
    })
  })

  it('surfaces the broker error and reason on a failed request', async () => {
    const response = new Response(JSON.stringify({ error: 'not_found', reason: 'no queue' }), {
      status: 404,
    })

    const result = await rabbitmqGetQueueTool.transformResponse!(response)

    expect(result.success).toBe(false)
    expect(result.error).toBe('RabbitMQ request failed (404): not_found: no queue')
  })

  it('decodes the binding properties key out of the location header', async () => {
    const response = new Response(null, {
      status: 201,
      headers: { location: 'orders/sim.a%252Fb' },
    })

    const result = await rabbitmqCreateBindingTool.transformResponse!(response, {
      ...conn,
      exchange: 'amq.topic',
      queue: 'orders',
      routingKey: 'sim.a/b',
    })

    expect(result.output.queueName).toBe('orders')
    expect(result.output.propertiesKey).toBe('sim.a%2Fb')
    expect(result.output.created).toBe(true)
  })

  it('returns a null properties key when the broker sent no location header', async () => {
    const response = new Response(null, { status: 201 })

    const result = await rabbitmqCreateBindingTool.transformResponse!(response, {
      ...conn,
      exchange: 'amq.topic',
      queue: 'orders',
    })

    expect(result.output.propertiesKey).toBeNull()
  })
})

describe('rabbitmq_get_messages bounds', () => {
  const body = (params: Record<string, unknown>) =>
    rabbitmqGetMessagesTool.request.body?.({ ...conn, ...params } as never) as Record<
      string,
      unknown
    >

  it('defaults to one message and a byte-capped payload', () => {
    expect(body({ queue: 'orders' })).toEqual({
      count: 1,
      ackmode: 'ack_requeue_true',
      encoding: 'auto',
      truncate: 50_000,
    })
  })

  it('caps a count the broker would otherwise accept unbounded', () => {
    expect(body({ queue: 'orders', count: 100_000 }).count).toBe(50)
    expect(body({ queue: 'orders', count: 0 }).count).toBe(1)
    expect(body({ queue: 'orders', count: 25 }).count).toBe(25)
  })

  it('falls back to the safe acknowledgement mode for an unknown value', () => {
    expect(body({ queue: 'orders', ackmode: 'destroy_everything' }).ackmode).toBe(
      'ack_requeue_true'
    )
    expect(body({ queue: 'orders', ackmode: 'ack_requeue_false' }).ackmode).toBe(
      'ack_requeue_false'
    )
  })

  it('flags a payload the broker cut short at the truncate limit', async () => {
    const response = new Response(
      JSON.stringify([
        { payload: 'X'.repeat(100), payload_bytes: 5000, payload_encoding: 'string' },
        { payload: 'small', payload_bytes: 5, payload_encoding: 'string' },
      ]),
      { status: 200 }
    )

    const result = await rabbitmqGetMessagesTool.transformResponse!(response, {
      ...conn,
      queue: 'orders',
      truncate: 100,
    })

    expect(result.output.messages[0]).toMatchObject({ payloadBytes: 5000, truncated: true })
    expect(result.output.messages[1]).toMatchObject({ payloadBytes: 5, truncated: false })
  })
})

describe('rabbitmq list bounds', () => {
  it('clamps a page size outside the range the broker accepts', () => {
    expect(url(rabbitmqListQueuesTool, { pageSize: 5000 })).toContain('page_size=500')
    expect(url(rabbitmqListQueuesTool, { pageSize: 0 })).toContain('page_size=1')
    expect(url(rabbitmqListQueuesTool, {})).toContain('page_size=50')
  })

  it('requests only the columns it projects', () => {
    const built = url(rabbitmqListQueuesTool, {})
    expect(built).toContain('columns=')
    expect(decodeURIComponent(built)).toContain('columns=name,vhost,type,state,durable')
  })
})

describe('rabbitmq path segments', () => {
  it('trims whitespace pasted around a queue name', () => {
    expect(url(rabbitmqGetQueueTool, { queue: '  orders  ' })).toBe(
      'https://rabbit.example.com:15672/api/queues/%2F/orders'
    )
  })
})

describe('rabbitmq_health_check', () => {
  it('routes each check to its own path, including the ones taking arguments', () => {
    const base = 'https://rabbit.example.com:15672/api/health/checks'
    expect(url(rabbitmqHealthCheckTool, {})).toBe(`${base}/alarms`)
    expect(url(rabbitmqHealthCheckTool, { check: 'virtual-hosts' })).toBe(`${base}/virtual-hosts`)
    expect(url(rabbitmqHealthCheckTool, { check: 'port-listener', port: 5672 })).toBe(
      `${base}/port-listener/5672`
    )
    expect(url(rabbitmqHealthCheckTool, { check: 'protocol-listener', protocol: 'amqp/ssl' })).toBe(
      `${base}/protocol-listener/amqp%2Fssl`
    )
    expect(
      url(rabbitmqHealthCheckTool, { check: 'certificate-expiration', within: 3, unit: 'weeks' })
    ).toBe(`${base}/certificate-expiration/3/weeks`)
  })

  it('names the missing argument instead of building a wrong URL', () => {
    expect(() => url(rabbitmqHealthCheckTool, { check: 'port-listener' })).toThrow(
      /port is required/
    )
    expect(() => url(rabbitmqHealthCheckTool, { check: 'protocol-listener' })).toThrow(
      /protocol is required/
    )
    expect(() => url(rabbitmqHealthCheckTool, { check: 'certificate-expiration' })).toThrow(
      /within is required/
    )
  })

  it('treats a failing check as a successful call reporting unhealthy', async () => {
    const response = new Response(
      JSON.stringify({ status: 'failed', reason: 'No active listener', missing: 9999 }),
      { status: 503 }
    )

    const result = await rabbitmqHealthCheckTool.transformResponse!(response, {
      ...conn,
      check: 'port-listener',
      port: 9999,
    })

    expect(result.success).toBe(true)
    expect(result.output.healthy).toBe(false)
    expect(result.output.status).toBe('failed')
    expect(result.output.reason).toBe('No active listener')
    expect(result.output.details).toMatchObject({ missing: 9999 })
  })

  it('still reports a real transport failure as an error', async () => {
    const response = new Response(JSON.stringify({ error: 'not_authorized' }), { status: 401 })

    const result = await rabbitmqHealthCheckTool.transformResponse!(response, { ...conn })

    expect(result.success).toBe(false)
    expect(result.output.healthy).toBe(false)
  })
})

describe('rabbitmq binding destinations', () => {
  it('addresses a queue destination by default and an exchange when asked', () => {
    expect(
      url(rabbitmqDeleteBindingTool, {
        exchange: 'orders',
        destination: 'orders-q',
        propertiesKey: 'a.b',
      })
    ).toBe('https://rabbit.example.com:15672/api/bindings/%2F/e/orders/q/orders-q/a.b')

    expect(
      url(rabbitmqDeleteBindingTool, {
        exchange: 'orders',
        destination: 'audit-x',
        destinationType: 'exchange',
        propertiesKey: '~',
      })
    ).toBe('https://rabbit.example.com:15672/api/bindings/%2F/e/orders/e/audit-x/~')
  })
})

describe('rabbitmq_list_vhosts', () => {
  it('never sends pagination parameters, which this endpoint answers with a 500', () => {
    expect(url(rabbitmqListVhostsTool, {})).toBe('https://rabbit.example.com:15672/api/vhosts')
  })
})

describe('rabbitmq_create_policy', () => {
  const body = (params: Record<string, unknown>) =>
    rabbitmqCreatePolicyTool.request.body?.({ ...conn, ...params } as never) as Record<
      string,
      unknown
    >

  it('sends the broker its hyphenated apply-to key with a safe default', () => {
    expect(
      body({ policyName: 'p', pattern: '^orders\\.', definition: '{"message-ttl":1000}' })
    ).toEqual({
      pattern: '^orders\\.',
      definition: { 'message-ttl': 1000 },
      priority: 0,
      'apply-to': 'queues',
    })
  })

  it('rejects an apply-to value the broker does not recognise', () => {
    expect(
      body({ policyName: 'p', pattern: '.*', definition: '{}', applyTo: 'bogus' })['apply-to']
    ).toBe('queues')
    expect(
      body({ policyName: 'p', pattern: '.*', definition: '{}', applyTo: 'quorum_queues' })[
        'apply-to'
      ]
    ).toBe('quorum_queues')
  })
})

describe('rabbitmq credential exposure', () => {
  it('strips the Basic auth header on every redirect, for every tool', () => {
    const tools = Object.values(rabbitmqTools)
    expect(tools.length).toBeGreaterThan(0)
    for (const tool of tools) {
      expect(`${tool.id}:${tool.request.stripAuthOnRedirect}`).toBe(`${tool.id}:true`)
    }
  })

  it('refuses a remote plain-http host rather than leaving it to fail at dispatch', () => {
    expect(() =>
      url(rabbitmqGetQueueTool, { host: 'http://rabbit.example.com:15672', queue: 'q' })
    ).toThrow(/must use https/)
    expect(() => url(rabbitmqGetQueueTool, { host: 'http://10.0.0.5:15672', queue: 'q' })).toThrow(
      /must use https/
    )
  })

  it('still allows a loopback host over plain http for local brokers', () => {
    expect(url(rabbitmqGetQueueTool, { host: 'http://localhost:15672', queue: 'q' })).toBe(
      'http://localhost:15672/api/queues/%2F/q'
    )
    expect(url(rabbitmqGetQueueTool, { host: 'http://127.0.0.1:15672', queue: 'q' })).toBe(
      'http://127.0.0.1:15672/api/queues/%2F/q'
    )
    expect(
      url(rabbitmqGetQueueTool, { host: 'https://rabbit.example.com:15672', queue: 'q' })
    ).toBe('https://rabbit.example.com:15672/api/queues/%2F/q')
  })
})

describe('rabbitmq_get_messages response budget', () => {
  const body = (params: Record<string, unknown>) =>
    rabbitmqGetMessagesTool.request.body?.({ ...conn, ...params } as never) as Record<
      string,
      number
    >

  const TRANSPORT_CAP = 10 * 1024 * 1024
  // `truncate` bounds the payload only — the broker returns AMQP properties in full — so the
  // worst case a batch can produce is every message also carrying a full content header frame.
  const FRAME_MAX = 131_072

  it('keeps payloads plus worst-case message metadata under the transport cap', () => {
    for (const count of [1, 2, 10, 25, 50, 100]) {
      const sent = body({ queue: 'q', count, truncate: 100_000_000 })
      expect(sent.count * (sent.truncate * (4 / 3) + FRAME_MAX)).toBeLessThan(TRANSPORT_CAP)
    }
  })

  it('caps the batch so reserved metadata alone cannot exhaust the budget', () => {
    expect(body({ queue: 'q', count: 100_000 }).count).toBe(50)
    expect(body({ queue: 'q', count: 100_000 }).count * FRAME_MAX).toBeLessThan(TRANSPORT_CAP)
  })

  it('caps a single oversized truncate request', () => {
    expect(body({ queue: 'q', truncate: 100_000_000 }).truncate).toBe(1_000_000)
  })

  it('leaves a reasonable truncate untouched at a low count', () => {
    expect(body({ queue: 'q', truncate: 20_000, count: 5 }).truncate).toBe(20_000)
  })

  it('shortens payloads rather than failing the retrieval when count is high', () => {
    expect(body({ queue: 'q', truncate: 50_000, count: 2 }).truncate).toBe(50_000)
    const high = body({ queue: 'q', truncate: 50_000, count: 50 }).truncate
    expect(high).toBeLessThan(50_000)
    expect(high).toBeGreaterThanOrEqual(1_024)
  })
})
