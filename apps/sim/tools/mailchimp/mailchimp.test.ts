/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { MailchimpBlock } from '@/blocks/blocks/mailchimp'
import { mailchimpAddMemberTagsTool } from '@/tools/mailchimp/add_member_tags'
import { mailchimpArchiveMemberTool } from '@/tools/mailchimp/archive_member'
import { mailchimpCreateBatchOperationTool } from '@/tools/mailchimp/create_batch_operation'
import { mailchimpDeleteMemberPermanentTool } from '@/tools/mailchimp/delete_member_permanent'
import { mailchimpGetCampaignReportTool } from '@/tools/mailchimp/get_campaign_report'
import { mailchimpGetMemberTool } from '@/tools/mailchimp/get_member'
import { mailchimpGetSegmentTool } from '@/tools/mailchimp/get_segment'
import { mailchimpRemoveMemberTagsTool } from '@/tools/mailchimp/remove_member_tags'
import { mailchimpSetCampaignContentTool } from '@/tools/mailchimp/set_campaign_content'
import { mailchimpUnarchiveMemberTool } from '@/tools/mailchimp/unarchive_member'
import { mailchimpUpdateAudienceTool } from '@/tools/mailchimp/update_audience'

const apiKey = 'abc123-us19'
const base = 'https://us19.api.mailchimp.com/3.0'
/** MD5 of "jane+news@example.com". */
const janeHash = '8caf13098f3fab452880dae284232834'

function urlOf<P>(tool: { request: { url: string | ((p: P) => string) } }, params: P): string {
  const { url } = tool.request
  return typeof url === 'function' ? url(params) : url
}

function bodyOf<P>(tool: { request: { body?: (p: P) => unknown } }, params: P): unknown {
  return tool.request.body?.(params)
}

describe('Mailchimp member addressing', () => {
  it('addresses a member by the MD5 of the lowercase email', () => {
    const url = urlOf(mailchimpGetMemberTool, {
      apiKey,
      listId: 'list1',
      subscriberEmail: ' Jane+News@Example.com ',
    })
    expect(url).toBe(`${base}/lists/list1/members/${janeHash}`)
  })

  it('rejects path separators and traversal in ids', () => {
    expect(() =>
      urlOf(mailchimpGetSegmentTool, { apiKey, listId: 'list1/../x', segmentId: '1' })
    ).toThrow(/path separator/)
    expect(() =>
      urlOf(mailchimpGetMemberTool, { apiKey, listId: 'list1', subscriberEmail: '..' })
    ).toThrow(/path traversal/)
  })
})

describe('Mailchimp archive vs permanent delete', () => {
  const params = { apiKey, listId: 'list1', subscriberEmail: janeHash }

  it('archives with DELETE on the member resource', () => {
    expect(mailchimpArchiveMemberTool.request.method).toBe('DELETE')
    expect(urlOf(mailchimpArchiveMemberTool, params)).toBe(
      `${base}/lists/list1/members/${janeHash}`
    )
  })

  it('permanently deletes with POST on the delete-permanent action', () => {
    expect(mailchimpDeleteMemberPermanentTool.request.method).toBe('POST')
    expect(urlOf(mailchimpDeleteMemberPermanentTool, params)).toBe(
      `${base}/lists/list1/members/${janeHash}/actions/delete-permanent`
    )
  })
})

describe('Mailchimp request bodies', () => {
  it('sends status_if_new when restoring an archived member', () => {
    expect(
      bodyOf(mailchimpUnarchiveMemberTool, {
        apiKey,
        listId: 'list1',
        subscriberEmail: janeHash,
        emailAddress: 'jane@example.com',
        status: 'subscribed',
      })
    ).toMatchObject({ status_if_new: 'subscribed' })
  })

  it('gives tags without a status the status implied by the operation', () => {
    const params = { apiKey, listId: 'list1', subscriberEmail: janeHash, tags: 'VIP, Newsletter' }
    expect(bodyOf(mailchimpAddMemberTagsTool, params)).toEqual({
      tags: [
        { name: 'VIP', status: 'active' },
        { name: 'Newsletter', status: 'active' },
      ],
    })
    expect(bodyOf(mailchimpRemoveMemberTagsTool, { ...params, tags: '[{"name":"VIP"}]' })).toEqual({
      tags: [{ name: 'VIP', status: 'inactive' }],
    })
  })

  it('keeps numeric tag names and rejects input with no tag names', () => {
    const params = { apiKey, listId: 'list1', subscriberEmail: janeHash }
    expect(bodyOf(mailchimpAddMemberTagsTool, { ...params, tags: '2024' })).toEqual({
      tags: [{ name: '2024', status: 'active' }],
    })
    expect(bodyOf(mailchimpAddMemberTagsTool, { ...params, tags: '1e3' })).toEqual({
      tags: [{ name: '1e3', status: 'active' }],
    })
    expect(() =>
      bodyOf(mailchimpAddMemberTagsTool, { ...params, tags: '[{"name":"VIP"}' })
    ).toThrow()
    expect(() => bodyOf(mailchimpAddMemberTagsTool, { ...params, tags: '[]' })).toThrow()
    expect(() =>
      bodyOf(mailchimpAddMemberTagsTool, { ...params, tags: '[{"name":"VIP","status":"paused"}]' })
    ).toThrow()
  })

  it('accepts an already-parsed operations array and rejects unparseable operations', () => {
    const operations = [{ method: 'GET', path: '/lists' }]
    expect(bodyOf(mailchimpCreateBatchOperationTool, { apiKey, operations })).toEqual({
      operations,
    })
    expect(() =>
      bodyOf(mailchimpCreateBatchOperationTool, { apiKey, operations: 'not json' })
    ).toThrow()
  })

  it('serializes an object batch operation body to the JSON string Mailchimp requires', () => {
    const body = bodyOf(mailchimpCreateBatchOperationTool, {
      apiKey,
      operations: JSON.stringify([
        { method: 'POST', path: '/lists/list1/members', body: { email_address: 'a@b.co' } },
        { method: 'GET', path: '/lists', body: '{"x":1}' },
      ]),
    })
    expect(body).toEqual({
      operations: [
        { method: 'POST', path: '/lists/list1/members', body: '{"email_address":"a@b.co"}' },
        { method: 'GET', path: '/lists', body: '{"x":1}' },
      ],
    })
  })
})

describe('Mailchimp campaign and audience requests', () => {
  it('reads the campaign id of a report from the id field', async () => {
    const transform = mailchimpGetCampaignReportTool.transformResponse
    if (!transform) throw new Error('missing transformResponse')
    const result = await transform(Response.json({ id: 'camp-1', campaign_title: 'Launch' }))
    expect(result.output.campaign_id).toBe('camp-1')
  })

  it('sends the template id as the integer the API requires', () => {
    expect(
      bodyOf(mailchimpSetCampaignContentTool, { apiKey, campaignId: 'camp-1', templateId: '42' })
    ).toMatchObject({ template: { id: 42 } })
    expect(() =>
      bodyOf(mailchimpSetCampaignContentTool, { apiKey, campaignId: 'camp-1', templateId: 'abc' })
    ).toThrow('templateId must be a positive integer')
  })

  it('leaves email_type_option unchanged when the stored value is null', () => {
    const body = bodyOf(mailchimpUpdateAudienceTool, {
      apiKey,
      listId: 'list1',
      emailTypeOption: null,
    })
    expect(body).not.toHaveProperty('email_type_option')
  })

  it('sends a boolean email_type_option from an agent as true', () => {
    const body = bodyOf(mailchimpUpdateAudienceTool, {
      apiKey,
      listId: 'list1',
      emailTypeOption: true,
    })
    expect(body).toMatchObject({ email_type_option: true })
  })
})

describe('Mailchimp email type option defaults', () => {
  const field = MailchimpBlock.subBlocks.find((subBlock) => subBlock.id === 'emailTypeOption')

  it('defaults to Keep current on update and true otherwise', () => {
    if (!field?.value) throw new Error('emailTypeOption has no default')
    expect(field.value({ operation: 'update_audience' })).toBe('')
    expect(field.value({ operation: 'create_audience' })).toBe('true')
    expect(field.value({})).toBe('true')
  })

  it('accepts Keep current when options are listed without block values', () => {
    if (typeof field?.options !== 'function') throw new Error('emailTypeOption options are static')
    expect(field.options().map((option) => option.id)).toEqual(['true', 'false', ''])
  })
})
