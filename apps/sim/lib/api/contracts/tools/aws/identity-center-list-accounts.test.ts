/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { awsIdentityCenterListAccountsContract } from '@/lib/api/contracts/tools/aws/identity-center-list-accounts'
import { awsIdentityCenterListAssignmentsForAccountContract } from '@/lib/api/contracts/tools/aws/identity-center-list-assignments-for-account'

const connection = {
  region: 'us-east-1',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secret',
}

/**
 * Organizations documents a 100,000-character maximum for the `ListAccounts`
 * continuation token, well past the Identity Store bound the rest of the family
 * shares.
 *
 * @see https://docs.aws.amazon.com/organizations/latest/APIReference/API_ListAccounts.html
 */
describe('identity center list-accounts nextToken bound', () => {
  it('accepts an Organizations token longer than the Identity Store bound', () => {
    const parsed = awsIdentityCenterListAccountsContract.body?.safeParse({
      ...connection,
      nextToken: 'a'.repeat(100_000),
    })
    expect(parsed?.success).toBe(true)
  })

  it('still rejects a token past the documented Organizations maximum', () => {
    const parsed = awsIdentityCenterListAccountsContract.body?.safeParse({
      ...connection,
      nextToken: 'a'.repeat(100_001),
    })
    expect(parsed?.success).toBe(false)
  })

  it('leaves the SSO Admin token bound where it was', () => {
    const parsed = awsIdentityCenterListAssignmentsForAccountContract.body?.safeParse({
      ...connection,
      instanceArn: 'arn:aws:sso:::instance/ssoins-0123456789abcdef',
      accountId: '111111111111',
      permissionSetArn: 'arn:aws:sso:::permissionSet/ssoins-0123456789abcdef/ps-0123456789abcdef',
      nextToken: 'a'.repeat(100_000),
    })
    expect(parsed?.success).toBe(false)
  })
})
