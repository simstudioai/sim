import { mkdtempSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { db, runOutsideTransactionContext } from '@sim/db'
import {
  folder,
  idempotencyKey,
  member,
  organization,
  outboxEvent,
  permissionGroup,
  permissionGroupWorkspace,
  permissions,
  project,
  publicShare,
  subscription,
  user,
  workspace,
  workspaceFileSecretProvenance,
  workspaceFiles,
} from '@sim/db/schema'
import { deleteWorkspaceFixture, insertWorkspaceFixture } from '@sim/db/testing/workspace-fixtures'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { emailMailerMock, emailMailerMockFns } from '@sim/testing/mocks/email-mailer.mock'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)
vi.mock('@/lib/messaging/email/mailer', () => emailMailerMock)

import * as sandboxTask from '@/lib/execution/sandbox/run-task'
import {
  createProjectFile,
  updateProjectFileContent,
} from '@/lib/projects/files/application/content'
import * as shareManager from '@/lib/public-shares/manager'
import * as storage from '@/lib/uploads/core/storage-service'

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

const localStorageRoot = mkdtempSync(join(tmpdir(), 'sim-project-content-'))
setUploadDirServer(localStorageRoot)
const fixtures: {
  ownerId: string
  editorId: string
  organizationId: string
  workspaceId: string
  projectId: string
}[] = []
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []

beforeEach(() => {
  vi.restoreAllMocks()
  featureFlagsMockFns.mockIsFeatureEnabled.mockImplementation(async (flag) => flag === 'projects')
  vi.stubEnv('FREE_STORAGE_LIMIT_GB', '')
})

function check(name: string, run: () => Promise<void>) {
  it(name, async () => {
    const started = performance.now()
    try {
      await run()
      checks.push({ name, status: 'passed', durationMs: performance.now() - started })
    } catch (error) {
      checks.push({
        name,
        status: 'failed',
        durationMs: performance.now() - started,
        error: getErrorMessage(error),
      })
      throw error
    }
  })
}

async function fixture() {
  const ownerId = generateId()
  const editorId = generateId()
  const organizationId = generateId()
  const workspaceId = generateId()
  await db.insert(user).values(
    [ownerId, editorId].map((id) => ({
      id,
      email: `${id}@content.invalid`,
      name: 'File content fixture',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  )
  await db
    .insert(organization)
    .values({ id: organizationId, name: 'Content', slug: organizationId, createdAt: new Date() })
  await db.insert(member).values(
    [ownerId, editorId].map((userId) => ({
      id: generateId(),
      organizationId,
      userId,
      role: userId === ownerId ? 'owner' : 'member',
      createdAt: new Date(),
    }))
  )
  await insertWorkspaceFixture(db, {
    id: workspaceId,
    ownerId,
    billedAccountUserId: ownerId,
    organizationId,
    workspaceMode: 'organization',
    name: 'Content environment',
  })
  const [binding] = await db.select().from(workspace).where(eq(workspace.id, workspaceId))
  if (!binding) throw new Error('Project fixture missing')
  await db.insert(permissions).values({
    id: generateId(),
    userId: editorId,
    entityType: 'workspace',
    entityId: workspaceId,
    permissionType: 'admin',
  })
  const ids = { ownerId, editorId, organizationId, workspaceId, projectId: binding.projectId }
  fixtures.push(ids)
  return { ...ids, principal: createSessionPrincipal({ userId: editorId }) }
}

function createInput(projectId: string, content = 'Project architecture') {
  return {
    projectId,
    name: 'architecture.md',
    contentType: 'text/markdown',
    content,
    encoding: 'utf-8' as const,
    exactName: true,
  }
}

describe('Public file shares against PostgreSQL and private storage', () => {
  check(
    'public delivery rejects unknown and secret-bearing provenance before storage',
    async () => {
      const { updateProjectFileShare } = await import('@/lib/projects/files/application/shares')
      const { authorizePublicFileShare, readPublicFileShareContent } = await import(
        '@/lib/public-shares/application'
      )
      const f = await fixture()
      for (const secretProvenance of [
        { status: 'unknown' as const },
        {
          status: 'exact' as const,
          entries: [{ encryptedValue: 'private-fixture', sourceUserId: f.editorId }],
        },
      ]) {
        const { file } = await createProjectFile.execute({
          principal: f.principal,
          input: {
            ...createInput(f.projectId),
            name: `${generateId()}.md`,
            secretProvenance,
          },
        })
        const { share } = await updateProjectFileShare.execute({
          principal: f.principal,
          input: {
            projectId: f.projectId,
            fileId: file.id,
            isActive: true,
          },
        })
        const access = await authorizePublicFileShare({
          token: share.token,
          credential: { method: 'GET' },
        })
        if (!access.authorized) throw new Error('Public fixture rejected')
        const download = vi.spyOn(storage, 'downloadFile')
        await expect(readPublicFileShareContent({ grant: access.grant })).rejects.toMatchObject({
          code: 'forbidden',
        })
        expect(download).not.toHaveBeenCalled()
        download.mockRestore()
      }
    }
  )

  check('non-SSO shares do not consult an unavailable session service', async () => {
    const { updateProjectFileShare } = await import('@/lib/projects/files/application/shares')
    const { authorizePublicFileShare } = await import('@/lib/public-shares/application')
    const f = await fixture()
    const { file } = await createProjectFile.execute({
      principal: f.principal,
      input: createInput(f.projectId),
    })
    const resolveSessionPrincipal = vi
      .fn()
      .mockRejectedValue(new Error('Session service unavailable'))
    for (const authType of ['public', 'password', 'email'] as const) {
      const { share } = await updateProjectFileShare.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          fileId: file.id,
          isActive: true,
          authType,
          password: 'fixture-password',
          allowedEmails: ['reader@shared.invalid'],
        },
      })
      const result = await authorizePublicFileShare({
        token: share.token,
        credential: { method: 'GET', resolveSessionPrincipal },
      })
      expect(result.authorized).toBe(authType === 'public')
    }
    expect(resolveSessionPrincipal).not.toHaveBeenCalled()
  })

  check(
    'public share configuration requires Project write and the canonical organization sharing policy',
    async () => {
      const { updateProjectFileShare, getProjectFileShare } = await import(
        '@/lib/projects/files/application/shares'
      )
      const f = await fixture()
      const other = await fixture()
      const { file } = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId),
      })
      const input = { projectId: f.projectId, fileId: file.id, isActive: true }
      const created = await updateProjectFileShare.execute({ principal: f.principal, input })
      expect(created.share.isActive).toBe(true)
      const [stored] = await db
        .select()
        .from(publicShare)
        .where(eq(publicShare.id, created.share.id))
      expect(stored).toMatchObject({
        entityType: 'project',
        entityId: f.projectId,
        workspaceId: null,
        createdBy: f.editorId,
      })
      await expect(
        getProjectFileShare.execute({
          principal: other.principal,
          input: { projectId: other.projectId, fileId: file.id },
        })
      ).rejects.toMatchObject({ code: 'not_found' })
      await db
        .update(permissions)
        .set({ permissionType: 'read' })
        .where(eq(permissions.userId, f.editorId))
      await expect(
        updateProjectFileShare.execute({ principal: f.principal, input })
      ).rejects.toMatchObject({ code: 'forbidden' })
      await db
        .update(permissions)
        .set({ permissionType: 'admin' })
        .where(eq(permissions.userId, f.editorId))
      await db.insert(subscription).values({
        id: generateId(),
        plan: 'enterprise',
        referenceId: f.organizationId,
        status: 'active',
        metadata: {},
      })
      await db.insert(permissionGroup).values({
        id: generateId(),
        organizationId: f.organizationId,
        createdBy: f.ownerId,
        name: 'No public sharing',
        isDefault: true,
        membershipMode: 'inherit',
        config: { disablePublicFileSharing: true },
      })
      await expect(
        updateProjectFileShare.execute({ principal: f.principal, input })
      ).rejects.toMatchObject({ detailCode: 'PUBLIC_SHARING_NOT_ALLOWED' })
      const disabled = await updateProjectFileShare.execute({
        principal: f.principal,
        input: { ...input, isActive: false },
      })
      expect(disabled.share).toMatchObject({ isActive: false, token: created.share.token })
    }
  )

  check(
    'public share policy includes each accessible active environment without a selected-environment bypass',
    async () => {
      const { updateProjectFileShare } = await import('@/lib/projects/files/application/shares')
      const f = await fixture()
      const { file } = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId),
      })
      const secondId = generateId()
      await insertWorkspaceFixture(db, {
        id: secondId,
        ownerId: f.ownerId,
        billedAccountUserId: f.ownerId,
        organizationId: f.organizationId,
        workspaceMode: 'organization',
        name: 'Restricted environment',
        forkedFromWorkspaceId: f.workspaceId,
      })
      try {
        await db.insert(subscription).values({
          id: generateId(),
          plan: 'enterprise',
          referenceId: f.organizationId,
          status: 'active',
          metadata: {},
        })
        const groupId = generateId()
        await db.insert(permissionGroup).values({
          id: groupId,
          organizationId: f.organizationId,
          createdBy: f.ownerId,
          name: 'Restricted sharing',
          membershipMode: 'inherit',
          config: { disablePublicFileSharing: true },
        })
        await db.insert(permissionGroupWorkspace).values({
          id: generateId(),
          permissionGroupId: groupId,
          workspaceId: secondId,
          organizationId: f.organizationId,
        })
        const input = { projectId: f.projectId, fileId: file.id, isActive: true }
        await updateProjectFileShare.execute({ principal: f.principal, input })
        await db.insert(permissions).values({
          id: generateId(),
          userId: f.editorId,
          entityType: 'workspace',
          entityId: secondId,
          permissionType: 'read',
        })
        await expect(
          updateProjectFileShare.execute({ principal: f.principal, input })
        ).rejects.toMatchObject({ detailCode: 'PUBLIC_SHARING_NOT_ALLOWED' })
        await db
          .update(permissionGroup)
          .set({ config: { allowedFileShareAuthTypes: ['password'] } })
          .where(eq(permissionGroup.id, groupId))
        await expect(
          updateProjectFileShare.execute({ principal: f.principal, input })
        ).rejects.toMatchObject({ detailCode: 'PUBLIC_SHARING_NOT_ALLOWED' })
        const allowed = await updateProjectFileShare.execute({
          principal: f.principal,
          input: { ...input, authType: 'password', password: 'a-valid-share-password' },
        })
        expect(allowed.share.authType).toBe('password')
        const upsert = shareManager.upsertOwnedFileShare
        const interleave = vi
          .spyOn(shareManager, 'upsertOwnedFileShare')
          .mockImplementationOnce(async (...args) => {
            await runOutsideTransactionContext(() =>
              db
                .update(publicShare)
                .set({ authType: 'public', isActive: false })
                .where(eq(publicShare.id, allowed.share.id))
            )
            return upsert(...args)
          })
        const reenabled = await updateProjectFileShare.execute({ principal: f.principal, input })
        expect(reenabled.share).toMatchObject({ authType: 'password', isActive: true })
        interleave.mockRestore()
      } finally {
        await deleteWorkspaceFixture(db, eq(workspace.id, secondId))
      }
    }
  )

  check(
    'public share credentials preserve password cookies, verified email, and actual session SSO identity',
    async () => {
      const { updateProjectFileShare } = await import('@/lib/projects/files/application/shares')
      const { authorizePublicFileShare, readPublicFileShareContent } = await import(
        '@/lib/public-shares/application'
      )
      const { setDeploymentAuthCookie, deploymentAuthCookieName } = await import(
        '@/lib/core/security/deployment'
      )
      const f = await fixture()
      const { file } = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId, 'Shared architecture'),
      })
      const input = { projectId: f.projectId, fileId: file.id, isActive: true }
      const { share } = await updateProjectFileShare.execute({
        principal: f.principal,
        input: { ...input, authType: 'password', password: 'correct-password' },
      })
      const token = share.token
      expect(
        await authorizePublicFileShare({ token, credential: { method: 'GET' } })
      ).toMatchObject({ authorized: false, error: 'auth_required_password' })
      expect(
        await authorizePublicFileShare({
          token,
          credential: { method: 'POST', password: 'wrong-password' },
        })
      ).toMatchObject({ authorized: false, error: 'Invalid password' })
      const accepted = await authorizePublicFileShare({
        token,
        credential: { method: 'POST', password: 'correct-password' },
      })
      if (!accepted.authorized) throw new Error('Correct share password rejected')
      expect((await readPublicFileShareContent({ grant: accepted.grant })).buffer.toString()).toBe(
        'Shared architecture'
      )
      const [passwordShare] = await db
        .select()
        .from(publicShare)
        .where(eq(publicShare.id, share.id))
      const response = NextResponse.json({})
      await setDeploymentAuthCookie({ response, cookiePrefix: 'file', resource: passwordShare })
      const cookies = Object.fromEntries(
        response.cookies.getAll().map(({ name, value }) => [name, value])
      )
      expect(
        await authorizePublicFileShare({ token, credential: { method: 'GET', cookies } })
      ).toMatchObject({ authorized: true })
      await updateProjectFileShare.execute({
        principal: f.principal,
        input: { ...input, authType: 'email', allowedEmails: ['viewer@shared.invalid'] },
      })
      expect(
        await authorizePublicFileShare({
          token,
          credential: { method: 'POST', email: 'viewer@shared.invalid', cookies },
        })
      ).toMatchObject({ authorized: false, error: 'otp_required' })
      const [emailShare] = await db.select().from(publicShare).where(eq(publicShare.id, share.id))
      await setDeploymentAuthCookie({
        response,
        cookiePrefix: 'file',
        resource: emailShare,
        verifiedEmail: 'viewer@shared.invalid',
      })
      const emailCookie = response.cookies.get(deploymentAuthCookieName('file', share.id))
      if (!emailCookie) throw new Error('Email fixture token missing')
      expect(
        await authorizePublicFileShare({
          token,
          credential: { method: 'GET', cookies: { [emailCookie.name]: emailCookie.value } },
        })
      ).toMatchObject({ authorized: true, authenticatedEmail: 'viewer@shared.invalid' })
      await updateProjectFileShare.execute({
        principal: f.principal,
        input: { ...input, authType: 'sso', allowedEmails: [`${f.editorId}@content.invalid`] },
      })
      expect(
        await authorizePublicFileShare({
          token,
          credential: { method: 'GET', email: `${f.editorId}@content.invalid` },
        })
      ).toMatchObject({ authorized: false, error: 'auth_required_sso' })
      expect(
        await authorizePublicFileShare({
          token,
          credential: { method: 'GET', sessionPrincipal: f.principal },
        })
      ).toMatchObject({ authorized: true, authenticatedEmail: `${f.editorId}@content.invalid` })
      expect(
        await authorizePublicFileShare({
          token,
          credential: {
            method: 'GET',
            sessionPrincipal: createSessionPrincipal({ userId: f.ownerId }),
          },
        })
      ).toMatchObject({ authorized: false })
    }
  )

  check(
    'public share password exchange binds its cookie to the current password and rejects wrong modes',
    async () => {
      const { updateProjectFileShare } = await import('@/lib/projects/files/application/shares')
      const { authorizePublicFileShare, authenticatePublicFileSharePassword } = await import(
        '@/lib/public-shares/application'
      )
      const f = await fixture()
      const { file } = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId),
      })
      const input = { projectId: f.projectId, fileId: file.id, isActive: true }
      const { share } = await updateProjectFileShare.execute({ principal: f.principal, input })
      await expect(
        authenticatePublicFileSharePassword({
          token: share.token,
          password: 'a-valid-share-password',
        })
      ).rejects.toMatchObject({ code: 'validation' })
      await updateProjectFileShare.execute({
        principal: f.principal,
        input: { ...input, authType: 'password', password: 'a-valid-share-password' },
      })
      expect(
        await authenticatePublicFileSharePassword({
          token: share.token,
          password: 'wrong-password',
        })
      ).toMatchObject({ authorized: false, error: 'Invalid password' })
      const access = await authenticatePublicFileSharePassword({
        token: share.token,
        password: 'a-valid-share-password',
      })
      if (!access.authorized) throw new Error('Password exchange failed')
      const cookies = { [access.cookie.name]: access.cookie.value }
      expect(
        await authorizePublicFileShare({
          token: share.token,
          credential: { method: 'GET', cookies },
        })
      ).toMatchObject({ authorized: true, authType: 'password' })
      await updateProjectFileShare.execute({
        principal: f.principal,
        input: { ...input, password: 'replacement-share-password' },
      })
      expect(
        await authorizePublicFileShare({
          token: share.token,
          credential: { method: 'GET', cookies },
        })
      ).toMatchObject({ authorized: false, authType: 'password' })
    }
  )

  check(
    'public share OTP delivery and verification retain allowlists, code attempts, and current token policy',
    async () => {
      const { updateProjectFileShare } = await import('@/lib/projects/files/application/shares')
      const { authorizePublicFileShare, requestPublicFileShareOtp, verifyPublicFileShareOtp } =
        await import('@/lib/public-shares/application')
      const otpStore = await import('@/lib/core/security/otp')
      const f = await fixture()
      const email = `${generateId()}@shared.invalid`
      const { file } = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId),
      })
      const input = {
        projectId: f.projectId,
        fileId: file.id,
        isActive: true,
        authType: 'email' as const,
        allowedEmails: [email],
      }
      const { share } = await updateProjectFileShare.execute({ principal: f.principal, input })
      emailMailerMockFns.mockSendEmail.mockResolvedValue({
        success: true,
        message: 'Local mail boundary accepted',
      })
      await (
        await requestPublicFileShareOtp({ token: share.token, email: 'outsider@shared.invalid' })
      ).deliver()
      expect(await otpStore.getOTP('file', share.id, 'outsider@shared.invalid')).toBeNull()
      const failure = { authorized: false, status: 400, error: 'Invalid verification code' }
      expect(
        await verifyPublicFileShareOtp({
          token: share.token,
          email: 'outsider@shared.invalid',
          otp: '000000',
        })
      ).toEqual(failure)
      expect(await verifyPublicFileShareOtp({ token: share.token, email, otp: '000000' })).toEqual(
        failure
      )
      await (await requestPublicFileShareOtp({ token: share.token, email })).deliver()
      const stored = await otpStore.getOTP('file', share.id, email)
      if (!stored) throw new Error('Allowed email received no code')
      const { otp } = otpStore.decodeOTPValue(stored)
      expect(
        await verifyPublicFileShareOtp({ token: share.token, email, otp: '000000' })
      ).toMatchObject({ authorized: false, status: 400 })
      const accepted = await verifyPublicFileShareOtp({ token: share.token, email, otp })
      if (!accepted.authorized) throw new Error('Valid verification code rejected')
      expect(
        await authorizePublicFileShare({
          token: share.token,
          credential: { method: 'GET', cookies: { [accepted.cookie.name]: accepted.cookie.value } },
        })
      ).toMatchObject({ authorized: true, authenticatedEmail: email })
      expect(await verifyPublicFileShareOtp({ token: share.token, email, otp })).toMatchObject({
        authorized: false,
        status: 400,
      })
      await otpStore.storeOTP('file', share.id, email, '123456')
      const get = otpStore.getOTP
      const spy = vi.spyOn(otpStore, 'getOTP').mockImplementation(async (...args) => {
        const result = await get(...args)
        await db
          .update(publicShare)
          .set({ allowedEmails: ['replacement@shared.invalid'] })
          .where(eq(publicShare.id, share.id))
        return result
      })
      await expect(
        verifyPublicFileShareOtp({ token: share.token, email, otp: '123456' })
      ).rejects.toMatchObject({ code: 'not_found' })
      spy.mockRestore()
      await otpStore.deleteOTP('file', share.id, email)
    }
  )

  check(
    'public share SSO eligibility never grants bytes and follows current active owner policy',
    async () => {
      const { updateProjectFileShare } = await import('@/lib/projects/files/application/shares')
      const { authorizePublicFileShare, getPublicFileShareSsoEligibility } = await import(
        '@/lib/public-shares/application'
      )
      const f = await fixture()
      const email = `${f.editorId}@content.invalid`
      const { file } = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId),
      })
      const { share } = await updateProjectFileShare.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          fileId: file.id,
          isActive: true,
          authType: 'sso',
          allowedEmails: [email],
        },
      })
      expect(await getPublicFileShareSsoEligibility({ token: share.token, email })).toEqual({
        allowed: true,
        eligible: true,
      })
      expect(
        await getPublicFileShareSsoEligibility({
          token: share.token,
          email: 'outsider@shared.invalid',
        })
      ).toEqual({ allowed: true, eligible: false })
      expect(
        await authorizePublicFileShare({ token: share.token, credential: { method: 'GET', email } })
      ).toMatchObject({ authorized: false, authType: 'sso' })
      await db.update(publicShare).set({ isActive: false }).where(eq(publicShare.id, share.id))
      await expect(
        getPublicFileShareSsoEligibility({ token: share.token, email })
      ).rejects.toMatchObject({ code: 'not_found' })
    }
  )

  check(
    'public share Office artifacts require the current owner-qualified dependency cache without compilation',
    async () => {
      const { updateProjectFileShare } = await import('@/lib/projects/files/application/shares')
      const { readProjectFileArtifact } = await import('@/lib/projects/files/application/artifacts')
      const { authorizePublicFileShare, readPublicFileShareContent } = await import(
        '@/lib/public-shares/application'
      )
      const f = await fixture()
      const asset = await createProjectFile.execute({
        principal: f.principal,
        input: { ...createInput(f.projectId, 'first input'), name: 'input.txt' },
      })
      const source = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId, `getFileBase64('${asset.file.id}')`),
          name: 'report.pptx',
          contentType: 'text/x-pptxgenjs',
        },
      })
      const { share } = await updateProjectFileShare.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileId: source.file.id, isActive: true },
      })
      const access = await authorizePublicFileShare({
        token: share.token,
        credential: { method: 'GET' },
      })
      if (!access.authorized) throw new Error('Public artifact fixture rejected')
      await expect(readPublicFileShareContent({ grant: access.grant })).rejects.toMatchObject({
        code: 'conflict',
      })
      vi.spyOn(sandboxTask, 'runSandboxTask').mockResolvedValue(
        Buffer.from('PK\u0003\u0004artifact')
      )
      const rendered = await readProjectFileArtifact.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileId: source.file.id, maxBytes: 1024 },
      })
      expect((await readPublicFileShareContent({ grant: access.grant })).buffer).toEqual(
        rendered.buffer
      )
      await updateProjectFileContent.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          fileId: asset.file.id,
          content: 'changed input',
          encoding: 'utf-8',
        },
      })
      await expect(readPublicFileShareContent({ grant: access.grant })).rejects.toMatchObject({
        code: 'conflict',
      })
    }
  )

  check(
    'public share revocation and password changes during object reads suppress downloaded bytes',
    async () => {
      const { updateProjectFileShare } = await import('@/lib/projects/files/application/shares')
      const { authorizePublicFileShare, readPublicFileShareContent } = await import(
        '@/lib/public-shares/application'
      )
      const { encryptSecret } = await import('@/lib/core/security/encryption')
      for (const change of ['disabled', 'password', 'archived', 'provenance'] as const) {
        const f = await fixture()
        const { file } = await createProjectFile.execute({
          principal: f.principal,
          input: createInput(f.projectId),
        })
        const { share } = await updateProjectFileShare.execute({
          principal: f.principal,
          input: {
            projectId: f.projectId,
            fileId: file.id,
            isActive: true,
            authType: 'password',
            password: 'initial-password',
          },
        })
        const access = await authorizePublicFileShare({
          token: share.token,
          credential: { method: 'POST', password: 'initial-password' },
        })
        if (!access.authorized) throw new Error('Initial credential rejected')
        const download = storage.downloadFile
        const spy = vi.spyOn(storage, 'downloadFile').mockImplementation(async (options) => {
          const result = await download(options)
          if (options.key === file.key) {
            if (change === 'disabled')
              await db
                .update(publicShare)
                .set({ isActive: false })
                .where(eq(publicShare.id, share.id))
            if (change === 'password')
              await db
                .update(publicShare)
                .set({ password: (await encryptSecret('replacement-password')).encrypted })
                .where(eq(publicShare.id, share.id))
            if (change === 'provenance')
              await db
                .update(workspaceFileSecretProvenance)
                .set({ status: 'unknown' })
                .where(eq(workspaceFileSecretProvenance.fileId, file.id))
            if (change === 'archived')
              await db
                .update(workspaceFiles)
                .set({ deletedAt: new Date() })
                .where(eq(workspaceFiles.id, file.id))
          }
          return result
        })
        await expect(readPublicFileShareContent({ grant: access.grant })).rejects.toMatchObject({
          code: change === 'provenance' ? 'forbidden' : 'not_found',
        })
        spy.mockRestore()
      }
    }
  )

  check(
    'public share grants cannot be cloned or reused after Project archive and preserve workspace links',
    async () => {
      const { updateProjectFileShare } = await import('@/lib/projects/files/application/shares')
      const { authorizePublicFileShare, readPublicFileShare, readPublicFileShareContent } =
        await import('@/lib/public-shares/application')
      const { uploadWorkspaceFile } = await import('@/lib/uploads/contexts/workspace/file-manager')
      const { upsertFileShare } = await import('@/lib/public-shares/manager')
      const f = await fixture()
      const { file } = await createProjectFile.execute({
        principal: f.principal,
        input: createInput(f.projectId),
      })
      const { share } = await updateProjectFileShare.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileId: file.id, isActive: true },
      })
      const access = await authorizePublicFileShare({
        token: share.token,
        credential: { method: 'GET' },
      })
      if (!access.authorized) throw new Error('Public share rejected')
      expect(await readPublicFileShare({ grant: access.grant })).toMatchObject({
        file: { id: file.id, originalName: 'architecture.md' },
      })
      await expect(
        readPublicFileShareContent({ grant: { ...access.grant } })
      ).rejects.toMatchObject({ code: 'not_found' })
      await db.transaction(async (tx) => {
        await tx
          .update(workspace)
          .set({ archivedAt: new Date() })
          .where(eq(workspace.id, f.workspaceId))
        await tx.update(project).set({ archivedAt: new Date() }).where(eq(project.id, f.projectId))
      })
      await expect(readPublicFileShare({ grant: access.grant })).rejects.toMatchObject({
        code: 'not_found',
      })
      await db.transaction(async (tx) => {
        await tx.update(project).set({ archivedAt: null }).where(eq(project.id, f.projectId))
        await tx.update(workspace).set({ archivedAt: null }).where(eq(workspace.id, f.workspaceId))
      })
      const legacy = await uploadWorkspaceFile(
        f.workspaceId,
        f.ownerId,
        Buffer.from('Workspace link'),
        'legacy.txt',
        'text/plain'
      )
      const legacyShare = await upsertFileShare({
        workspaceId: f.workspaceId,
        fileId: legacy.id,
        userId: f.ownerId,
        isActive: true,
      })
      const legacyAccess = await authorizePublicFileShare({
        token: legacyShare.token,
        credential: { method: 'GET' },
      })
      if (!legacyAccess.authorized) throw new Error('Existing workspace share rejected')
      expect(
        (await readPublicFileShareContent({ grant: legacyAccess.grant })).buffer.toString()
      ).toBe('Workspace link')
    }
  )

  check(
    'public share page assets remain confined to explicit references in the canonical owner',
    async () => {
      const { updateProjectFileShare } = await import('@/lib/projects/files/application/shares')
      const { authorizePublicFileShare, readPublicFileShareContent, readPublicFileShareInline } =
        await import('@/lib/public-shares/application')
      const f = await fixture()
      const other = await fixture()
      const image = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9uoAAAAASUVORK5CYII=',
        'base64'
      )
      const asset = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(f.projectId, image.toString('base64')),
          encoding: 'base64',
          name: 'diagram.png',
          contentType: 'image/png',
        },
      })
      const sibling = await createProjectFile.execute({
        principal: f.principal,
        input: { ...createInput(f.projectId, 'Private sibling'), name: 'private.txt' },
      })
      const foreign = await createProjectFile.execute({
        principal: other.principal,
        input: createInput(other.projectId),
      })
      const source = await createProjectFile.execute({
        principal: f.principal,
        input: {
          ...createInput(
            f.projectId,
            `---\ntitle: Architecture\n---\n\n![Diagram](sim:file/${asset.file.id})`
          ),
          name: 'Architecture',
          contentType: 'text/x-sim-page',
        },
      })
      const { share } = await updateProjectFileShare.execute({
        principal: f.principal,
        input: { projectId: f.projectId, fileId: source.file.id, isActive: true },
      })
      const access = await authorizePublicFileShare({
        token: share.token,
        credential: { method: 'GET' },
      })
      if (!access.authorized) throw new Error('Public page rejected')
      const rendered = await readPublicFileShareContent({ grant: access.grant })
      expect(rendered.contentType).toBe('text/html')
      expect(rendered.buffer.toString()).toContain(
        `data:image/png;base64,${image.toString('base64')}`
      )
      expect(
        (await readPublicFileShareInline({ grant: access.grant, fileId: asset.file.id })).buffer
      ).toEqual(image)
      for (const fileId of [sibling.file.id, foreign.file.id])
        await expect(
          readPublicFileShareInline({ grant: access.grant, fileId })
        ).rejects.toMatchObject({ code: 'not_found' })
      await updateProjectFileContent.execute({
        principal: f.principal,
        input: {
          projectId: f.projectId,
          fileId: source.file.id,
          content: `---\ntitle: Architecture\n---\n\n![Foreign](sim:file/${foreign.file.id})`,
          encoding: 'utf-8',
        },
      })
      await expect(readPublicFileShareContent({ grant: access.grant })).rejects.toMatchObject({
        code: 'not_found',
      })
    }
  )
})

afterAll(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  for (const f of fixtures) {
    await db.delete(idempotencyKey).where(sql`${idempotencyKey.key} LIKE ${`%${f.projectId}%`}`)
    await db
      .delete(outboxEvent)
      .where(
        sql`${outboxEvent.payload}::jsonb ->> 'key' LIKE ${`project/${f.projectId}/%`} OR ${outboxEvent.payload}::jsonb -> 'owner' ->> 'entityId' = ${f.projectId}`
      )
    await db
      .delete(publicShare)
      .where(and(eq(publicShare.entityType, 'project'), eq(publicShare.entityId, f.projectId)))
    await db.delete(workspaceFiles).where(eq(workspaceFiles.projectId, f.projectId))
    await db.delete(folder).where(eq(folder.projectId, f.projectId))
    await deleteWorkspaceFixture(db, eq(workspace.id, f.workspaceId))
    await db.delete(subscription).where(eq(subscription.referenceId, f.organizationId))
    await db.delete(organization).where(eq(organization.id, f.organizationId))
    await db.delete(user).where(inArray(user.id, [f.ownerId, f.editorId]))
  }
  await rm(localStorageRoot, { recursive: true, force: true })
  const report =
    process.env.PROJECT_FILE_CONTENT_REPORT_PATH ?? 'test-results/project-file-content.json'
  await mkdir(dirname(report), { recursive: true })
  await writeFile(report, JSON.stringify({ checks }, null, 2))
  await db.$client.end()
})
