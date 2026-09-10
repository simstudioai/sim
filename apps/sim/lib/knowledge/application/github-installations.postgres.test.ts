/** @vitest-environment node */
import { db } from '@sim/db'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEnterpriseSearchMigrationFixture } from '@/lib/knowledge/__integration__/migration-fixture'

vi.unmock('drizzle-orm')
vi.unmock('@sim/db/schema')

const mocks = vi.hoisted(() => ({ token: vi.fn(), list: vi.fn() }))
vi.mock('@/lib/knowledge/application/authorized-knowledge-use-case', () => ({
  defineAuthorizedKnowledgeUseCase: (definition: {
    execute: (args: {
      principal: { userId: string }
      input: { organizationId: string }
      context: { organizationId: string }
    }) => Promise<unknown>
  }) => ({
    execute: (args: { principal: { userId: string }; input: { organizationId: string } }) =>
      definition.execute({ ...args, context: { organizationId: args.input.organizationId } }),
  }),
}))
vi.mock('@/lib/knowledge/application/operations', () => ({
  knowledgeOperations: { listGitHubInstallations: {}, connectGitHubInstallation: {} },
}))
vi.mock('@/lib/knowledge/application/contexts', () => ({
  resolveKnowledgeOrganizationContext: vi.fn(),
}))
vi.mock('@/lib/knowledge/access/availability', () => ({
  requireOrganizationSearchAvailable: vi.fn(),
}))
vi.mock('@/lib/credentials/managed-oauth', () => ({ resolveManagedOAuthToken: mocks.token }))
vi.mock('@/lib/credential-groups/provider-registry', () => ({
  getCredentialGroupProviderAdapter: () => ({
    getPolicy: async () => ({ authorizationAppId: 'current-app', scopeVersion: 1 }),
  }),
}))
vi.mock('@/lib/oauth/github-installation', () => ({
  getGitHubInstallationConfiguration: () => ({
    configured: true,
    installUrl: 'https://github.com/apps/example/installations/new',
  }),
  listUserAdminGitHubInstallations: mocks.list,
  verifyGitHubInstallationBinding: vi.fn(),
}))
vi.mock('@/lib/core/security/encryption', () => ({ encryptSecret: vi.fn() }))

import { listGitHubSearchInstallations } from '@/lib/knowledge/application/github-installations'

const { drizzle } = await import('drizzle-orm/postgres-js')
const schema = await import('@sim/db/schema')
const databaseUrl = process.env.KNOWLEDGE_ACL_TEST_DATABASE_URL

/** Exercises the production reader-selection SQL against isolated local PostgreSQL tables. */
describe.runIf(Boolean(databaseUrl))(
  'GitHub installation setup reader ownership in PostgreSQL',
  () => {
    let fixture: Awaited<ReturnType<typeof createEnterpriseSearchMigrationFixture>>
    let executor: PostgresJsDatabase<typeof schema>

    beforeAll(async () => {
      fixture = await createEnterpriseSearchMigrationFixture(databaseUrl!)
      await fixture.migrate()
      await fixture.client.unsafe(`
      ALTER TABLE credential ADD COLUMN revoked_at timestamp,
        ADD COLUMN credential_group_option_id text, ADD COLUMN managed_oauth_scope_version integer;
      ALTER TABLE credential_group ADD COLUMN options jsonb NOT NULL DEFAULT '[]';
      ALTER TABLE credential_group_enrollment ADD COLUMN user_id text;
      INSERT INTO organization(id) VALUES ('setup-org'), ('other-org');
    `)
      executor = drizzle(fixture.client, { schema })
      vi.mocked(db.select).mockImplementation(executor.select.bind(executor))
    })

    afterAll(async () => {
      await fixture?.cleanup()
    })

    beforeEach(async () => {
      vi.clearAllMocks()
      mocks.token.mockResolvedValue({ accessToken: 'ghu_alice' })
      mocks.list.mockResolvedValue([])
      await fixture.client.unsafe(`
      TRUNCATE credential, credential_group_enrollment, credential_group CASCADE;
      INSERT INTO credential_group(id,organization_id,name,status,options)
        VALUES ('setup-group','setup-org','GitHub','active',
          '[{"id":"github-option","provider":"github-repositories","status":"active"}]');
      INSERT INTO credential_group_enrollment(id,credential_group_id,email,status,user_id)
        VALUES ('setup-enrollment','setup-group','alice@example.com','completed','alice');
      INSERT INTO credential(id,organization_id,type,provider_id,provider_subject_id,authorization_app_id,
        managed_oauth_status,managed_oauth_scope_version,granted_scopes,encrypted_oauth_token_set,granted_at,
        credential_group_enrollment_id,credential_group_option_id)
        VALUES ('alice-github','setup-org','managed_oauth','github-repositories','123','current-app','active',1,
          ARRAY[]::text[],'encrypted',now(),'setup-enrollment','github-option');
    `)
    })

    function list(userId = 'alice', organizationId = 'setup-org') {
      return listGitHubSearchInstallations.execute({
        principal: { kind: 'session', userId, sessionId: 'session' },
        input: { organizationId },
      })
    }

    it('selects the acting person’s active credential in the canonical organization', async () => {
      expect(await list()).toMatchObject({ needsUserConnection: false })
      expect(mocks.token).toHaveBeenCalledWith({
        credentialId: 'alice-github',
        organizationId: 'setup-org',
        expectedProviderId: 'github-repositories',
        requiredScopes: [],
      })
      expect(await list('bob')).toMatchObject({ needsUserConnection: true })
      expect(await list('alice', 'other-org')).toMatchObject({ needsUserConnection: true })
      expect(mocks.token).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['credential owner', "UPDATE credential SET organization_id='other-org'"],
      ['group owner', "UPDATE credential_group SET organization_id='other-org'"],
      ['credential revocation', 'UPDATE credential SET revoked_at=now()'],
      ['enrollment revocation', 'UPDATE credential_group_enrollment SET revoked_at=now()'],
      ['revoked enrollment status', "UPDATE credential_group_enrollment SET status='revoked'"],
      ['inactive credential', "UPDATE credential SET managed_oauth_status='revoked'"],
      ['inactive group', "UPDATE credential_group SET status='archived'"],
      [
        'disabled option',
        `UPDATE credential_group SET options='[{"id":"github-option","provider":"github-repositories","status":"disabled"}]'`,
      ],
      [
        'different option provider',
        `UPDATE credential_group SET options='[{"id":"github-option","provider":"other","status":"active"}]'`,
      ],
      ['different option', "UPDATE credential SET credential_group_option_id='other-option'"],
      ['stale app identity', "UPDATE credential SET authorization_app_id='old-app'"],
      ['stale scope policy', 'UPDATE credential SET managed_oauth_scope_version=0'],
    ])('denies %s before using any GitHub token', async (_name, mutation) => {
      await fixture.client.unsafe(mutation)
      expect(await list()).toMatchObject({ needsUserConnection: true, installations: [] })
      expect(mocks.token).not.toHaveBeenCalled()
      expect(mocks.list).not.toHaveBeenCalled()
    })
  }
)
