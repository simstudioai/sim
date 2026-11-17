import { describe, expect, it } from 'vitest'
import { LinearV2Block } from '@/blocks/blocks/linear'
import type { BlockToolParamsContext } from '@/blocks/types'

function mapParams(params: Record<string, unknown>, context?: BlockToolParamsContext) {
  const mapper = LinearV2Block.tools.config?.params
  if (!mapper) throw new Error('Linear block has no params mapper')
  return mapper(params, context)
}

/** What the tool receives: the mapper's result spread over the params it was given. */
function sent(params: Record<string, unknown>, context?: BlockToolParamsContext) {
  return { ...params, ...mapParams(params, context) }
}

describe('Linear agent tool calls', () => {
  it('uses the Customer ID filled in the tool row', () => {
    const toolParams = sent({ customerIdTarget: 'cust-1' }, { operation: 'linear_get_customer' })
    expect(toolParams.customerId).toBe('cust-1')
  })

  it('keeps the model customer fields when no block field is filled', () => {
    const toolParams = sent(
      { name: 'Acme', domains: ['acme.com'], revenue: 5000, size: 40 },
      { operation: 'linear_create_customer' }
    )
    expect(toolParams).toMatchObject({
      name: 'Acme',
      domains: ['acme.com'],
      revenue: 5000,
      size: 40,
    })
  })

  it('keeps the model project and label ids for Add Label to Project', () => {
    const toolParams = sent(
      { projectId: 'proj-1', labelId: 'plabel-1' },
      { operation: 'linear_add_label_to_project' }
    )
    expect(toolParams).toMatchObject({ projectId: 'proj-1', labelId: 'plabel-1' })
  })

  it('keeps the model attachment title on Update Attachment', () => {
    const toolParams = sent(
      { attachmentId: 'att-1', title: 'Spec' },
      { operation: 'linear_update_attachment' }
    )
    expect(toolParams.title).toBe('Spec')
  })

  it('keeps a model priority of 0 on Update Issue', () => {
    const toolParams = sent({ issueId: 'ENG-1', priority: 0 }, { operation: 'linear_update_issue' })
    expect(toolParams.priority).toBe(0)
  })

  it('keeps the model readAt when the tool row leaves Mark as Read unset', () => {
    const readAt = '2026-11-01T00:00:00.000Z'
    const toolParams = sent(
      { notificationId: 'n1', readAt },
      { operation: 'linear_update_notification' }
    )
    expect(toolParams.readAt).toBe(readAt)
  })

  it('keeps the model includeArchived on List Customers', () => {
    const toolParams = sent({ includeArchived: true }, { operation: 'linear_list_customers' })
    expect(toolParams.includeArchived).toBe(true)
  })
})

describe('Linear canvas requests', () => {
  it('sends Blocked by as the related issue blocking this one', () => {
    const inputs = {
      operation: 'linear_create_issue_relation',
      issueId: 'ENG-1',
      relatedIssueId: 'ENG-2',
      relationType: 'blocked',
    }
    expect(sent(inputs)).toMatchObject({
      issueId: 'ENG-2',
      relatedIssueId: 'ENG-1',
      type: 'blocks',
    })
  })

  it('sends the customer details filled on Create Customer', () => {
    const inputs = {
      operation: 'linear_create_customer',
      customerName: 'Acme',
      customerExternalIds: 'crm-1, crm-2',
      customerOwnerId: ' user-1 ',
      customerRevenue: '100000',
      customerSize: '25',
      customerLogoUrl: 'https://acme.test/logo.png',
    }
    expect(sent(inputs)).toMatchObject({
      name: 'Acme',
      externalIds: ['crm-1', 'crm-2'],
      ownerId: 'user-1',
      revenue: 100000,
      size: 25,
      logoUrl: 'https://acme.test/logo.png',
    })
  })

  it('leaves the urgency unchanged when Update Customer Request picks No change', () => {
    const inputs = {
      operation: 'linear_update_customer_request',
      customerNeedId: 'need-1',
      customerRequestPriority: '',
    }
    expect(sent(inputs).priority).toBeUndefined()
  })

  it('sends Label IDs typed as a comma-separated list as an array', () => {
    const inputs = { operation: 'linear_read_issues', labelIds: 'lbl-1, lbl-2' }
    expect(sent(inputs).labelIds).toEqual(['lbl-1', 'lbl-2'])
  })

  it('moves an updated project to the chosen project status', () => {
    const inputs = {
      operation: 'linear_update_project',
      projectId: 'proj-1',
      projectUpdateStatusId: ' status-1 ',
    }
    expect(sent(inputs).statusId).toBe('status-1')
  })

  it('does not move an updated project to a Status ID left over from a project status operation', () => {
    const inputs = {
      operation: 'linear_update_project',
      projectId: 'proj-1',
      name: 'Renamed',
      projectStatusId: 'ps-old',
    }
    expect(sent(inputs).statusId).toBeUndefined()
  })
})
