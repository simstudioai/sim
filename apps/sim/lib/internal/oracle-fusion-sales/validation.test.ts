/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { parseOracleFusionSalesInput } from '@/lib/internal/oracle-fusion-sales/schema'

const AUTH = {
  oauthCredential: 'credential-1',
  accessToken: 'test-token',
  instanceUrl: 'https://vision.fa.us2.oraclecloud.com',
}

describe('Oracle Fusion Sales request validation', () => {
  it.each([
    ['create_account', {}],
    ['create_account', { organizationName: ' ' }],
    ['create_contact', {}],
    ['create_contact', { firstName: ' ', lastName: '' }],
    ['create_lead', { name: '' }],
    ['create_opportunity', { name: ' ' }],
    ['create_appointment', { subject: 'Meeting' }],
    ['create_call_report', { subject: 'Call', startDateTime: '2026-09-01T12:00:00Z' }],
    ['create_task', { subject: 'Task', dueDate: '2026-02-30' }],
    ['update_account', { accountNumber: 'A001' }],
    ['update_account', { accountNumber: 'A001', organizationName: '' }],
    ['update_activity', { activityNumber: 'ACT001', activityFunctionCode: 'TASK' }],
    [
      'update_opportunity_team_member',
      { opportunityNumber: 'O001', teamMemberKey: 'KEY', ownerId: '123' },
    ],
    ['create_opportunity_revenue', { opportunityNumber: 'O001' }],
    ['create_opportunity_revenue', { opportunityNumber: 'O001', inventoryItemId: '123' }],
    [
      'create_opportunity_revenue',
      {
        opportunityNumber: 'O001',
        productGroupId: '123',
        inventoryItemId: '124',
        inventoryOrganizationId: '125',
      },
    ],
    ['list_accounts', { limit: 101 }],
    ['list_contacts', { offset: -1 }],
    ['list_leads', { limit: 1.5 }],
    ['list_activities', { totalResults: 'true' }],
    ['list_opportunities', { q: 'x'.repeat(2049) }],
    ['list_sales_resources', { offset: Number.MAX_SAFE_INTEGER }],
    ['find_duplicate_accounts', { matchingFields: {} }],
    ['find_duplicate_contacts', { matchingFields: { FirstName: 123 } }],
    ['get_lead', { leadKey: '../accounts' }],
    ['get_account', { accountNumber: 'https://other.fa.us2.oraclecloud.com/accounts/A001' }],
  ])('rejects invalid %s inputs', (operation, params) => {
    expect(() => parseOracleFusionSalesInput(operation, { ...AUTH, ...params })).toThrow()
  })

  it.each(['0', '-1', '1.5', '1e3', '01', '123\n', '9223372036854775808', 9007199254740992])(
    'rejects non-canonical or out-of-range body identifier %s',
    (leadId) => {
      expect(() => parseOracleFusionSalesInput('accept_lead', { ...AUTH, leadId })).toThrow()
    }
  )

  it('retains exact identifiers and applies bounded page defaults', () => {
    expect(
      parseOracleFusionSalesInput('accept_lead', {
        ...AUTH,
        leadId: '9007199254740993',
      }).leadId
    ).toBe('9007199254740993')
    expect(parseOracleFusionSalesInput('list_accounts', AUTH)).toMatchObject({
      limit: 50,
      offset: 0,
      totalResults: false,
    })
  })

  it('requires only a first or last name, not server-generated party/address identifiers', () => {
    expect(
      parseOracleFusionSalesInput('create_contact', {
        ...AUTH,
        lastName: 'Smith',
      }).lastName
    ).toBe('Smith')
    expect(
      parseOracleFusionSalesInput('create_account', {
        ...AUTH,
        organizationName: 'Example',
      }).organizationName
    ).toBe('Example')
    expect(
      parseOracleFusionSalesInput('create_opportunity', {
        ...AUTH,
        name: 'Renewal',
      }).name
    ).toBe('Renewal')
  })

  it('distinguishes omission from an explicit nullable field clear', () => {
    const clear = parseOracleFusionSalesInput('update_account', {
      ...AUTH,
      accountNumber: 'A001',
      description: null,
    })
    expect(clear).toHaveProperty('description', null)
    expect(clear).not.toHaveProperty('emailAddress')
    expect(() =>
      parseOracleFusionSalesInput('update_opportunity', {
        ...AUTH,
        opportunityNumber: 'O001',
        ownerId: null,
      })
    ).toThrow()
  })

  it('requires valid time ordering without inventing tenant status enums', () => {
    expect(() =>
      parseOracleFusionSalesInput('create_appointment', {
        ...AUTH,
        subject: 'Review',
        startDateTime: '2026-09-01T13:00:00Z',
        endDateTime: '2026-09-01T12:00:00Z',
      })
    ).toThrow()
    expect(
      parseOracleFusionSalesInput('update_lead', {
        ...AUTH,
        leadKey: 'OPAQUE-KEY',
        statusCode: 'TENANT_QUALIFIED',
      }).statusCode
    ).toBe('TENANT_QUALIFIED')
  })

  it('rejects unknown operations and undeclared provider fields', () => {
    expect(() => parseOracleFusionSalesInput('constructor', AUTH)).toThrow()
    expect(() =>
      parseOracleFusionSalesInput('create_account', {
        ...AUTH,
        organizationName: 'Example',
        arbitraryProviderBody: { secret: 'value' },
      })
    ).toThrow()
  })
})
