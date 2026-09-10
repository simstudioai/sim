/** @vitest-environment node */
import { credential, credentialGroup, credentialGroupEnrollment } from '@sim/db/schema'
import { dbChainMockFns, queueTableRows, resetDbChainMock } from '@sim/testing'
import { eq, inArray, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/connectors/registry', () => ({
  getConnectorMeta: (id: string) => ({
    requiresMemberIdentity: id === 'slack',
    auth: { mode: 'oauth', provider: id },
  }),
}))

import { resolveViewerSourceAccounts } from '@/lib/knowledge/connectors/viewer-source-accounts'
import { SEARCH_SOURCE_CANDIDATE_PAGE_SIZE } from '@/lib/knowledge/constants'

const source = {
  id: 'gmail-source',
  connectorType: 'gmail',
  accessMode: 'members',
  credentialGroupId: 'group-1',
  credentialGroupOptionId: 'gmail-option',
}
const input = { organizationId: 'org-1', userId: 'viewer', connectors: [source] }
const account = {
  credentialId: 'mine',
  displayName: 'My Gmail',
  groupId: 'group-1',
  optionId: 'gmail-option',
  providerId: 'gmail',
}

describe('personal source account projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('binds the current contributor and organization on both credentials and groups', async () => {
    queueTableRows(credential, [account])
    const result = await resolveViewerSourceAccounts(input)
    expect(eq).toHaveBeenCalledWith(credentialGroupEnrollment.userId, 'viewer')
    expect(eq).toHaveBeenCalledWith(credential.organizationId, 'org-1')
    expect(eq).toHaveBeenCalledWith(credentialGroup.organizationId, 'org-1')
    expect(isNull).toHaveBeenCalledWith(credential.workspaceId)
    expect(isNull).toHaveBeenCalledWith(credentialGroup.workspaceId)
    expect(isNull).toHaveBeenCalledWith(credential.revokedAt)
    expect(inArray).toHaveBeenCalledWith(credential.managedOauthStatus, ['active', 'needs_reauth'])
    expect(result.get(source.id)).toEqual([{ credentialId: 'mine', displayName: 'My Gmail' }])
    expect(dbChainMockFns.select).toHaveBeenCalledWith({
      credentialId: credential.id,
      displayName: credential.displayName,
      groupId: credentialGroup.id,
      optionId: credential.credentialGroupOptionId,
      providerId: credential.providerId,
    })
  })

  it('does not attach an account from another source option or group', async () => {
    queueTableRows(credential, [
      { ...account, groupId: 'other' },
      { ...account, optionId: 'other' },
    ])
    expect(await resolveViewerSourceAccounts(input)).toEqual(new Map())
  })

  it('maps Slack personal identity accounts without offering its administrative bot credential', async () => {
    queueTableRows(credential, [
      { ...account, providerId: 'slack', credentialId: 'slack-personal' },
    ])
    const result = await resolveViewerSourceAccounts({
      ...input,
      connectors: [
        {
          ...source,
          id: 'slack-source',
          connectorType: 'slack',
          accessMode: 'admin',
          credentialGroupId: null,
          credentialGroupOptionId: null,
        },
      ],
    })
    expect(eq).toHaveBeenCalledWith(credential.type, 'managed_oauth')
    expect(eq).toHaveBeenCalledWith(credential.providerId, 'slack')
    expect(result.get('slack-source')).toEqual([
      { credentialId: 'slack-personal', displayName: 'My Gmail' },
    ])
  })

  it('fails instead of silently truncating too many accounts', async () => {
    queueTableRows(
      credential,
      Array.from({ length: SEARCH_SOURCE_CANDIDATE_PAGE_SIZE + 1 }, () => account)
    )
    await expect(resolveViewerSourceAccounts(input)).rejects.toThrow('Too many personal accounts')
  })
})
