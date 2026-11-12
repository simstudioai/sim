/** A saved AWS credential resolved for a Bedrock model call against real credential rows. */

import { withAuditRollupScope } from '@sim/audit'
import { db } from '@sim/db'
import {
  auditLog,
  credential,
  credentialMember,
  permissions,
  user,
  workspace,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { encryptSecret } from '@/lib/core/security/encryption'
import {
  BedrockCredentialError,
  resolveBedrockCredentialSession,
} from '@/lib/internal/llm/bedrock-credential'

const workspaceId = generateId()
const otherWorkspaceId = generateId()
const memberId = generateId()
const outsiderId = generateId()
const awsCredentialId = generateId()
const revokedAwsCredentialId = generateId()
const otherWorkspaceAwsCredentialId = generateId()
const googleCredentialId = generateId()
const userIds = [memberId, outsiderId]

const ACCESS_KEY_ID = 'AKIAFIXTUREKEY000001'
const SECRET_ACCESS_KEY = 'fixture-secret-access-key'

async function storedAwsKeys(): Promise<string> {
  const { encrypted } = await encryptSecret(
    JSON.stringify({
      type: 'aws_credential_v1',
      config: {
        authType: 'access_keys',
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET_ACCESS_KEY,
      },
    })
  )
  return encrypted
}

function resolveAs(actingUserId: string | undefined, credentialId: string, scope = workspaceId) {
  return resolveBedrockCredentialSession({
    credentialId,
    actingUserId,
    workspaceId: scope,
    executionId: 'bedrock-credential-fixture',
  })
}

describe('resolveBedrockCredentialSession', () => {
  beforeAll(async () => {
    const now = new Date()
    await db.insert(user).values(
      userIds.map((id) => ({
        id,
        name: 'Bedrock credential fixture',
        email: `${id}@bedrock-credential.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      }))
    )
    await insertWorkspaceFixture(
      db,
      [workspaceId, otherWorkspaceId].map((id) => ({
        id,
        name: 'Bedrock credential fixture',
        ownerId: memberId,
        billedAccountUserId: memberId,
      }))
    )
    await db.insert(permissions).values(
      (
        [
          [memberId, workspaceId],
          [memberId, otherWorkspaceId],
          [outsiderId, workspaceId],
        ] as const
      ).map(([userId, entityId]) => ({
        id: generateId(),
        userId,
        entityType: 'workspace',
        entityId,
        permissionType: 'write' as const,
      }))
    )
    const encryptedKeys = await storedAwsKeys()
    await db.insert(credential).values([
      {
        id: awsCredentialId,
        type: 'service_account',
        workspaceId,
        providerId: 'aws-service-account',
        displayName: 'AWS fixture',
        encryptedServiceAccountKey: encryptedKeys,
        createdBy: memberId,
      },
      {
        id: revokedAwsCredentialId,
        type: 'service_account',
        workspaceId,
        providerId: 'aws-service-account',
        displayName: 'Revoked AWS fixture',
        encryptedServiceAccountKey: encryptedKeys,
        revokedAt: now,
        createdBy: memberId,
      },
      {
        id: otherWorkspaceAwsCredentialId,
        type: 'service_account',
        workspaceId: otherWorkspaceId,
        providerId: 'aws-service-account',
        displayName: 'Other workspace AWS fixture',
        encryptedServiceAccountKey: encryptedKeys,
        createdBy: memberId,
      },
      {
        id: googleCredentialId,
        type: 'service_account',
        workspaceId,
        providerId: 'google-service-account',
        displayName: 'Google fixture',
        encryptedServiceAccountKey: encryptedKeys,
        createdBy: memberId,
      },
    ])
    await db.insert(credentialMember).values(
      [
        awsCredentialId,
        revokedAwsCredentialId,
        otherWorkspaceAwsCredentialId,
        googleCredentialId,
      ].map((credentialId) => ({
        id: generateId(),
        credentialId,
        userId: memberId,
        role: 'member' as const,
        status: 'active' as const,
      }))
    )
  })

  afterAll(async () => {
    await db.delete(auditLog).where(inArray(auditLog.workspaceId, [workspaceId, otherWorkspaceId]))
    await deleteWorkspaceFixture(db, inArray(workspace.id, [workspaceId, otherWorkspaceId]))
    await db.delete(user).where(inArray(user.id, userIds))
  })

  it("resolves a credential member's saved access keys for the credential's workspace", async () => {
    await expect(withAuditRollupScope(() => resolveAs(memberId, awsCredentialId))).resolves.toEqual(
      {
        credentialId: awsCredentialId,
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET_ACCESS_KEY,
      }
    )

    const audits = await db
      .select({ actorId: auditLog.actorId })
      .from(auditLog)
      .where(and(eq(auditLog.workspaceId, workspaceId), eq(auditLog.resourceId, awsCredentialId)))
    expect(audits).toEqual([{ actorId: memberId }])
  })

  it('refuses a run with no acting user', async () => {
    await expect(resolveAs(undefined, awsCredentialId)).rejects.toBeInstanceOf(
      BedrockCredentialError
    )
  })

  it('refuses a workspace member the credential was never shared with', async () => {
    await expect(resolveAs(outsiderId, awsCredentialId)).rejects.toBeInstanceOf(
      BedrockCredentialError
    )
  })

  it('refuses a credential from another workspace than the run', async () => {
    await expect(resolveAs(memberId, otherWorkspaceAwsCredentialId)).rejects.toBeInstanceOf(
      BedrockCredentialError
    )
  })

  it('refuses a saved credential of another provider', async () => {
    await expect(resolveAs(memberId, googleCredentialId)).rejects.toThrow(
      'Could not use the AWS credential: AWS credential is unavailable'
    )
  })

  it('refuses a revoked AWS credential', async () => {
    await expect(resolveAs(memberId, revokedAwsCredentialId)).rejects.toThrow(
      'Could not use the AWS credential: AWS credential is unavailable'
    )
  })

  it('refuses an unknown credential id', async () => {
    await expect(resolveAs(memberId, generateId())).rejects.toBeInstanceOf(BedrockCredentialError)
  })
})
