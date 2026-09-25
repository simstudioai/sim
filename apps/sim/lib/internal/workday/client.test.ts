import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildServiceUrl,
  createWorkdaySoapClient,
  extractRefId,
} from '@/lib/internal/workday/client'

const SUCCESS_RESPONSE = `<?xml version="1.0" encoding="UTF-8"?>
<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wd="urn:com.workday/bsvc">
  <env:Body>
    <wd:Get_Workers_Response>
      <wd:Response_Data>
        <wd:Worker>
          <wd:Worker_Reference>
            <wd:ID wd:type="Employee_ID">worker-1</wd:ID>
          </wd:Worker_Reference>
        </wd:Worker>
      </wd:Response_Data>
      <wd:Response_Results>
        <wd:Total_Results>1</wd:Total_Results>
      </wd:Response_Results>
    </wd:Get_Workers_Response>
  </env:Body>
</env:Envelope>`

describe('Workday SOAP client', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds an allowlisted Workday service URL and rejects untrusted hosts', () => {
    expect(
      buildServiceUrl('https://wd2-impl-services1.workday.com/', 'example', 'humanResources')
    ).toBe('https://wd2-impl-services1.workday.com/ccx/service/example/Human_Resources/v45.2')
    expect(() => buildServiceUrl('https://127.0.0.1', 'example', 'staffing')).toThrow(
      'tenantUrl must be a Workday-hosted domain'
    )
  })

  it('passes cancellation to fetch, escapes XML, and parses SOAP responses', async () => {
    fetchMock.mockResolvedValue(new Response(SUCCESS_RESPONSE, { status: 200 }))
    const controller = new AbortController()
    const client = await createWorkdaySoapClient(
      'https://wd2-impl-services1.workday.com',
      'example',
      'humanResources',
      'user<&',
      'password<&',
      controller.signal
    )

    const [result] = await client.Get_WorkersAsync({
      Request_References: {
        Worker_Reference: { ID: { $value: 'worker<&', attributes: { 'wd:type': 'Employee_ID' } } },
      },
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://wd2-impl-services1.workday.com/ccx/service/example/Human_Resources/v45.2'
    )
    expect(init).toMatchObject({ method: 'POST', signal: controller.signal })
    expect(init?.body).toContain('<wsse:Username>user&lt;&amp;</wsse:Username>')
    expect(init?.body).toContain('<wsse:Password Type=')
    expect(init?.body).toContain('password&lt;&amp;</wsse:Password>')
    expect(init?.body).toContain('worker&lt;&amp;</wd:ID>')
    const worker = result.Response_Data?.Worker as {
      Worker_Reference?: { ID?: { $value?: string } }
    }
    expect(extractRefId(worker.Worker_Reference)).toBe('worker-1')
    expect(result.Response_Results?.Total_Results).toBe('1')
  })
})
