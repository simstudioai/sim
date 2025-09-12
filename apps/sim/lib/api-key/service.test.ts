import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '@/db'
import { apiKey as apiKeyTable, user, workspace } from '@/db/schema'
import { createApiKey } from './auth'
import { authenticateApiKeyFromHeader, generateApiKey, updateApiKeyLastUsed } from './service'

describe('API Key Service', () => {
  let testUserId: string
  let testWorkspaceId: string
  let testPersonalKeyId: string
  let testWorkspaceKeyId: string
  let testPersonalKey: string
  let testWorkspaceKey: string

  beforeAll(async () => {
    const [testUser] = await db
      .insert(user)
      .values({
        id: 'test-user-id',
        name: 'Test User',
        email: 'test@example.com',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: user.id })
    testUserId = testUser.id

    const [testWorkspace] = await db
      .insert(workspace)
      .values({
        id: 'test-workspace-id',
        name: 'Test Workspace',
        ownerId: testUserId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: workspace.id })
    testWorkspaceId = testWorkspace.id

    const personalKeyResult = await createApiKey(true, true)
    testPersonalKey = personalKeyResult.key
    const [personalKey] = await db
      .insert(apiKeyTable)
      .values({
        id: 'test-personal-key-id',
        userId: testUserId,
        name: 'Test Personal Key',
        key: personalKeyResult.encryptedKey!,
        type: 'personal',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: apiKeyTable.id })
    testPersonalKeyId = personalKey.id

    const workspaceKeyResult = await createApiKey(true, true)
    testWorkspaceKey = workspaceKeyResult.key
    const [workspaceKey] = await db
      .insert(apiKeyTable)
      .values({
        id: 'test-workspace-key-id',
        userId: testUserId,
        workspaceId: testWorkspaceId,
        createdBy: testUserId,
        name: 'Test Workspace Key',
        key: workspaceKeyResult.encryptedKey!,
        type: 'workspace',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: apiKeyTable.id })
    testWorkspaceKeyId = workspaceKey.id
  })

  afterAll(async () => {
    await db.delete(apiKeyTable).where(eq(apiKeyTable.userId, testUserId))
    await db.delete(workspace).where(eq(workspace.id, testWorkspaceId))
    await db.delete(user).where(eq(user.id, testUserId))
  })

  it.concurrent('authenticates valid personal API key', async () => {
    const result = await authenticateApiKeyFromHeader(testPersonalKey)

    expect(result.success).toBe(true)
    expect(result.userId).toBe(testUserId)
    expect(result.keyType).toBe('personal')
    expect(result.keyId).toBe(testPersonalKeyId)
  })

  it.concurrent('authenticates valid workspace API key', async () => {
    const result = await authenticateApiKeyFromHeader(testWorkspaceKey)

    expect(result.success).toBe(true)
    expect(result.userId).toBe(testUserId)
    expect(result.keyType).toBe('workspace')
    expect(result.keyId).toBe(testWorkspaceKeyId)
    expect(result.workspaceId).toBe(testWorkspaceId)
  })

  it.concurrent('filters by userId correctly', async () => {
    const result = await authenticateApiKeyFromHeader(testPersonalKey, {
      userId: testUserId,
      keyTypes: ['personal'],
    })

    expect(result.success).toBe(true)
    expect(result.userId).toBe(testUserId)
  })

  it.concurrent('filters by workspaceId correctly', async () => {
    const result = await authenticateApiKeyFromHeader(testWorkspaceKey, {
      workspaceId: testWorkspaceId,
      keyTypes: ['workspace'],
    })

    expect(result.success).toBe(true)
    expect(result.workspaceId).toBe(testWorkspaceId)
  })

  it.concurrent('fails authentication with invalid key', async () => {
    const result = await authenticateApiKeyFromHeader('invalid-key')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid API key')
  })

  it.concurrent('updates last used timestamp', async () => {
    const beforeUpdate = new Date()
    await updateApiKeyLastUsed(testPersonalKeyId)

    const [updatedKey] = await db
      .select({ lastUsed: apiKeyTable.lastUsed })
      .from(apiKeyTable)
      .where(eq(apiKeyTable.id, testPersonalKeyId))
      .limit(1)

    expect(updatedKey.lastUsed).toBeInstanceOf(Date)
    expect(updatedKey.lastUsed!.getTime()).toBeGreaterThanOrEqual(beforeUpdate.getTime())
  })
})

describe('generateApiKey', () => {
  it.concurrent('should generate API key with sim_ prefix', () => {
    const key = generateApiKey()
    expect(key).toMatch(/^sim_/)
  })

  it.concurrent('should generate unique API keys for each call', () => {
    const key1 = generateApiKey()
    const key2 = generateApiKey()
    expect(key1).not.toBe(key2)
  })

  it.concurrent('should generate API keys of correct length', () => {
    const key = generateApiKey()
    // Expected format: 'sim_' + 32 random characters
    expect(key.length).toBe(36)
  })
})
