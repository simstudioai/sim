/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildSdpAssetEntity,
  buildSdpChangeEntity,
  buildSdpProblemEntity,
  buildSdpSolutionEntity,
} from '@/tools/manageengine_sdp/entity-builders'
import { toSdpDateTime } from '@/tools/manageengine_sdp/utils'

const BASE = { accessToken: 't' }

describe('buildSdpProblemEntity', () => {
  it('wraps lookups by name and users by email, matching the documented shapes', () => {
    expect(
      buildSdpProblemEntity({
        ...BASE,
        title: 'Mail relay flapping',
        status: 'Open',
        reportedByEmail: 'lincoln@example.com',
      })
    ).toEqual({
      title: 'Mail relay flapping',
      status: { name: 'Open' },
      reported_by: { email_id: 'lincoln@example.com' },
    })
  })

  it('omits every untouched field so an edit never clears one', () => {
    expect(buildSdpProblemEntity({ ...BASE, status: 'Closed' })).toEqual({
      status: { name: 'Closed' },
    })
  })
})

describe('buildSdpChangeEntity', () => {
  it('sends stage and status as sibling lookups, not nested under one another', () => {
    expect(
      buildSdpChangeEntity({
        ...BASE,
        title: 'Firewall upgrade',
        stage: 'Submission',
        status: 'Open',
      })
    ).toEqual({
      title: 'Firewall upgrade',
      stage: { name: 'Submission' },
      status: { name: 'Open' },
    })
  })

  it('converts a scheduled time to the epoch-millisecond value object', () => {
    expect(
      buildSdpChangeEntity({ ...BASE, scheduledStartTime: '2026-09-03T12:00:00.000Z' })
    ).toEqual({ scheduled_start_time: { value: '1788436800000' } })
  })

  it('keeps emergency:false, which downgrades an emergency change', () => {
    expect(buildSdpChangeEntity({ ...BASE, emergency: false })).toEqual({ emergency: false })
  })

  it('forwards the status comment ServiceDesk Plus requires on a status change', () => {
    expect(buildSdpChangeEntity({ ...BASE, status: 'Closed', comment: 'Rolled out' })).toEqual({
      status: { name: 'Closed' },
      comment: 'Rolled out',
    })
  })
})

describe('buildSdpAssetEntity', () => {
  it('sends name as a plain string and product as a lookup', () => {
    expect(buildSdpAssetEntity({ ...BASE, name: 'LAPTOP-014', product: 'MacBook Pro' })).toEqual({
      name: 'LAPTOP-014',
      product: { name: 'MacBook Pro' },
    })
  })

  it('addresses the assigned user by email', () => {
    expect(buildSdpAssetEntity({ ...BASE, userEmail: 'lincoln@example.com' })).toEqual({
      user: { email_id: 'lincoln@example.com' },
    })
  })
})

describe('buildSdpSolutionEntity', () => {
  it('sends the topic as a lookup and keeps is_public:false', () => {
    expect(
      buildSdpSolutionEntity({ ...BASE, title: 'Reset VPN', topic: 'Networking', isPublic: false })
    ).toEqual({
      title: 'Reset VPN',
      topic: { name: 'Networking' },
      is_public: false,
    })
  })

  it('rejects unparseable custom-field JSON by naming the field', () => {
    expect(() => buildSdpSolutionEntity({ ...BASE, udfFields: '{oops' })).toThrow(/custom fields/)
  })
})

describe('toSdpDateTime', () => {
  it('passes epoch milliseconds through unchanged', () => {
    expect(toSdpDateTime('1478758440000', 'Scheduled start')).toEqual({ value: '1478758440000' })
    expect(toSdpDateTime(1478758440000, 'Scheduled start')).toEqual({ value: '1478758440000' })
  })

  it('converts an ISO 8601 timestamp', () => {
    expect(toSdpDateTime('2016-11-10T06:14:00.000Z', 'Scheduled start')).toEqual({
      value: '1478758440000',
    })
  })

  it('returns undefined when absent, so the field is omitted', () => {
    expect(toSdpDateTime(undefined, 'Scheduled start')).toBeUndefined()
    expect(toSdpDateTime('', 'Scheduled start')).toBeUndefined()
  })

  it('throws on an unparseable value rather than silently scheduling nothing', () => {
    expect(() => toSdpDateTime('next tuesday', 'Scheduled start')).toThrow(/Scheduled start/)
  })
})
