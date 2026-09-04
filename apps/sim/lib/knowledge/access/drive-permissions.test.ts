/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  type DrivePermission,
  driveFileAcl,
  type OpenSharingPolicy,
} from '@/lib/knowledge/access/drive-permissions'
import { domainGroupId } from '@/lib/knowledge/access/external-groups'
import { ACCESS_TOKEN_PATTERN } from '@/lib/knowledge/access/tokens'

const PROVIDER = 'google-drive'
const TENANT = 'C01abcdef'
const OPEN: OpenSharingPolicy = { domain: true, anyone: true }

const CLOSED_OPEN_SHARING = { domain: false, anyone: false } as const

function acl(permissions: DrivePermission[], policy: OpenSharingPolicy = CLOSED_OPEN_SHARING) {
  return driveFileAcl({ permissions, providerId: PROVIDER, tenantId: TENANT, policy })
}

describe('driveFileAcl', () => {
  it('grants a named person their own token, case-folded', () => {
    expect(acl([{ type: 'user', emailAddress: 'Alice@Corp.com' }])).toEqual(['u:alice@corp.com'])
  })

  it('grants a group by its email, which is the only identifier Drive returns', () => {
    expect(acl([{ type: 'group', emailAddress: 'Sales@corp.com' }])).toEqual([
      `g:${PROVIDER}:${TENANT}:sales@corp.com`,
    ])
  })

  it('keeps every grant on a file shared several ways', () => {
    expect(
      acl([
        { type: 'user', emailAddress: 'alice@corp.com' },
        { type: 'user', emailAddress: 'bob@corp.com' },
        { type: 'group', emailAddress: 'sales@corp.com' },
      ])
    ).toEqual([`g:${PROVIDER}:${TENANT}:sales@corp.com`, 'u:alice@corp.com', 'u:bob@corp.com'])
  })

  it('drops the grant of a deleted account rather than minting a token for a recycled address', () => {
    expect(
      acl([
        { type: 'user', emailAddress: 'gone@corp.com', deleted: true },
        { type: 'user', emailAddress: 'alice@corp.com' },
      ])
    ).toEqual(['u:alice@corp.com'])
  })

  describe('open sharing is closed by default', () => {
    it('drops a whole-domain share', () => {
      expect(acl([{ type: 'domain', domain: 'corp.com' }])).toEqual(['link'])
    })

    it('drops a discoverable anyone share', () => {
      expect(acl([{ type: 'anyone' }])).toEqual(['link'])
    })

    it('leaves the file readable by whoever was named on it', () => {
      expect(
        acl([
          { type: 'user', emailAddress: 'alice@corp.com' },
          { type: 'domain', domain: 'corp.com' },
        ])
      ).toEqual(['u:alice@corp.com'])
    })
  })

  describe('open sharing, once an admin opts in', () => {
    it('grants a whole-domain share to a synthetic domain group', () => {
      expect(acl([{ type: 'domain', domain: 'Corp.com' }], OPEN)).toEqual([
        `g:${PROVIDER}:${TENANT}:domain:corp.com`,
      ])
    })

    it('grants a discoverable anyone share to everyone', () => {
      expect(acl([{ type: 'anyone' }], OPEN)).toEqual(['pub'])
      expect(acl([{ type: 'anyone', allowFileDiscovery: true }], OPEN)).toEqual(['pub'])
    })

    /**
     * The deviation from Onyx that matters most: their file path makes an
     * `anyone` grant public without consulting `allowFileDiscovery`, so a file
     * anyone ever shared by link becomes fully searchable.
     */
    it('still refuses a link-only anyone share', () => {
      expect(acl([{ type: 'anyone', allowFileDiscovery: false }], OPEN)).toEqual(['link'])
    })

    it('still refuses a link-only domain share', () => {
      expect(
        acl([{ type: 'domain', domain: 'corp.com', allowFileDiscovery: false }], OPEN)
      ).toEqual(['link'])
    })
  })

  describe('grants that cannot be attributed', () => {
    it('drops a principal with no email rather than guessing', () => {
      expect(acl([{ type: 'user', emailAddress: null }])).toEqual(['link'])
      expect(acl([{ type: 'group', emailAddress: '' }])).toEqual(['link'])
    })

    it('drops a domain share naming no domain', () => {
      expect(acl([{ type: 'domain', domain: null }], OPEN)).toEqual(['link'])
    })

    it('ignores a permission type it does not understand', () => {
      expect(
        acl([{ type: 'someFutureType' }, { type: 'user', emailAddress: 'alice@corp.com' }])
      ).toEqual(['u:alice@corp.com'])
    })

    it('resolves a file with no permissions at all to link, not to nobody', () => {
      expect(acl([])).toEqual(['link'])
    })
  })

  it('emits sorted, de-duplicated tokens so two crawls agree byte for byte', () => {
    expect(
      acl([
        { type: 'user', emailAddress: 'zoe@corp.com' },
        { type: 'user', emailAddress: 'alice@corp.com' },
        { type: 'user', emailAddress: 'ALICE@corp.com' },
      ])
    ).toEqual(['u:alice@corp.com', 'u:zoe@corp.com'])
  })

  it('only ever emits tokens the document ACL constraint accepts', () => {
    const tokens = acl(
      [
        { type: 'user', emailAddress: 'alice@corp.com' },
        { type: 'group', emailAddress: 'sales@corp.com' },
        { type: 'domain', domain: 'corp.com' },
        { type: 'anyone' },
      ],
      OPEN
    )
    for (const token of tokens) expect(token).toMatch(ACCESS_TOKEN_PATTERN)
  })
})

describe('domainGroupId', () => {
  it('case-folds so one domain is one group', () => {
    expect(domainGroupId(' Corp.COM ')).toBe('domain:corp.com')
  })
})
