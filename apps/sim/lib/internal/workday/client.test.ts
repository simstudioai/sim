import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildServiceUrl,
  createWorkdaySoapClient,
  extractRefId,
} from '@/lib/internal/workday/client'
import { executeWorkdayGetOrganizations } from '@/lib/internal/workday/operations'

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

  it('builds an allowlisted Workday service URL and rejects untrusted hosts', () => {
    expect(
      buildServiceUrl('https://wd2-impl-services1.workday.com/', 'example', 'humanResources')
    ).toBe('https://wd2-impl-services1.workday.com/ccx/service/example/Human_Resources/v45.2')
    expect(() => buildServiceUrl('https://127.0.0.1', 'example', 'staffing')).toThrow(
      'tenantUrl must be a Workday-hosted domain'
    )
  })

  it('sends Get_Organizations criteria before the response filter, in schema order', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        '<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wd="urn:com.workday/bsvc"><env:Body><wd:Get_Organizations_Response/></env:Body></env:Envelope>',
        { status: 200 }
      )
    )

    await executeWorkdayGetOrganizations({
      tenantUrl: 'https://wd2-impl-services1.workday.com',
      tenant: 'example',
      username: 'user',
      password: 'password',
      type: 'Supervisory',
    })

    const body = String(fetchMock.mock.calls[0]?.[1]?.body)
    const criteria = body.indexOf('<wd:Request_Criteria>')
    const filter = body.indexOf('<wd:Response_Filter>')
    const group = body.indexOf('<wd:Response_Group>')
    expect(criteria).toBeGreaterThan(-1)
    expect(criteria).toBeLessThan(filter)
    expect(filter).toBeLessThan(group)
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

  it.each([
    ['Hire_EmployeeAsync', 'Hire_Employee_Event_Response'],
    ['Terminate_EmployeeAsync', 'Terminate_Employee_Event_Response'],
  ] as const)('parses %s from its %s element', async (method, responseElement) => {
    fetchMock.mockResolvedValue(
      new Response(
        `<?xml version="1.0" encoding="UTF-8"?>
<env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wd="urn:com.workday/bsvc">
  <env:Body>
    <wd:${responseElement}>
      <wd:Event_Reference><wd:ID wd:type="WID">event-1</wd:ID></wd:Event_Reference>
      <wd:Employee_Reference><wd:ID wd:type="Employee_ID">04345</wd:ID></wd:Employee_Reference>
    </wd:${responseElement}>
  </env:Body>
</env:Envelope>`,
        { status: 200 }
      )
    )
    const client = await createWorkdaySoapClient(
      'https://wd2-impl-services1.workday.com',
      'example',
      'staffing',
      'user',
      'password'
    )

    const [result] = await client[method]({})

    expect(extractRefId(result.Event_Reference)).toBe('event-1')
    expect(extractRefId(result.Employee_Reference)).toBe('04345')
  })
})
