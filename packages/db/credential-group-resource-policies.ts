import type { Sql } from 'postgres'

export const CREDENTIAL_GROUP_POLICY_BATCH_SIZE = 500
export const CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT = 50
export const CREDENTIAL_GROUP_POLICY_DOCUMENT_MAX_BYTES = 32 * 1024
export const ORGANIZATION_ACCOUNT_POLICY_DOCUMENT_MAX_BYTES = 256 * 1024

const ACTOR_ACCESS_SID = 'CredentialGroupActorCredentialAccess'
const WORKFLOW_ACCESS_SID = 'WorkflowCredentialAccess'
/** Statements the knowledge module writes for connectors crawling through an option. */
const KNOWLEDGE_CONNECTOR_ACCESS_SID_PREFIX = 'KnowledgeConnectorCredentialAccess:'
const CREDENTIAL_USE_ACTION = 'credential_groups.credentials.use'
const ACTOR_OWNS_CREDENTIAL_CONDITION_KEY = 'credential_group:ActorOwnsCredential'
const DEPLOYMENT_MODE_CONDITION_KEY = 'execution:WorkflowMode'

interface CredentialGroupActorAccessStatement {
  sid: typeof ACTOR_ACCESS_SID
  effect: 'allow'
  actions: [typeof CREDENTIAL_USE_ACTION]
  principals: [{ type: 'credential_group_actor' }]
  condition: {
    Bool: {
      [ACTOR_OWNS_CREDENTIAL_CONDITION_KEY]: true
    }
  }
}

interface CredentialGroupWorkflowAccessStatement {
  sid: typeof WORKFLOW_ACCESS_SID
  effect: 'allow'
  actions: [typeof CREDENTIAL_USE_ACTION]
  principals: Array<{ type: 'workflow'; workflowId: string }>
  condition: {
    StringEquals: {
      [DEPLOYMENT_MODE_CONDITION_KEY]: 'deployment'
    }
  }
}

/**
 * A statement the knowledge module writes so one of its connectors can crawl
 * through a group option. The knowledge module owns and validates its shape;
 * this package only carries it through unchanged.
 */
interface CredentialGroupKnowledgeConnectorAccessStatement {
  sid: `${typeof KNOWLEDGE_CONNECTOR_ACCESS_SID_PREFIX}${string}`
  [key: string]: unknown
}

export interface CredentialGroupWorkflowAccessPolicyDocument {
  version: 1
  resource: {
    type: 'credential_group'
    id: string
  }
  statements:
    | [CredentialGroupActorAccessStatement, ...CredentialGroupKnowledgeConnectorAccessStatement[]]
    | [
        CredentialGroupActorAccessStatement,
        CredentialGroupWorkflowAccessStatement,
        ...CredentialGroupKnowledgeConnectorAccessStatement[],
      ]
}

export interface MissingCredentialGroupPolicyRow {
  id: string
  workspaceId: string
  createdBy: string | null
}

export interface StoredCredentialGroupPolicyRow {
  id: string
  organizationId?: string | null
  workspaceId: string | null
  resourceId: string
  revision: number
  documentBytes: number
  document: unknown
}

export interface CredentialGroupPolicyInvariantViolation {
  kind: 'missing' | 'workspace_mismatch' | 'orphan'
  resourceId: string
}

export interface CredentialGroupPolicyLifecycleStore {
  installLifecycleTrigger(): Promise<void>
  listMissingPolicies(afterId: string, limit: number): Promise<MissingCredentialGroupPolicyRow[]>
  insertDefaultPolicies(rows: MissingCredentialGroupPolicyRow[]): Promise<number>
  findRelationalInvariantViolation(): Promise<CredentialGroupPolicyInvariantViolation | null>
  listPolicies(afterId: string, limit: number): Promise<StoredCredentialGroupPolicyRow[]>
}

interface ReconcileCredentialGroupPoliciesOptions {
  batchSize?: number
}

export interface CredentialGroupPolicyReconciliationResult {
  scannedMissing: number
  inserted: number
  validated: number
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort()
  const canonicalExpected = [...expected].sort()
  if (
    actual.length !== canonicalExpected.length ||
    actual.some((key, index) => key !== canonicalExpected[index])
  ) {
    throw new Error(`${label} has an invalid shape`)
  }
}

function requireCanonicalId(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 128 ||
    value.trim() !== value
  ) {
    throw new Error(`${label} must be a canonical identifier`)
  }
  return value
}

function createCredentialGroupActorAccessStatement(): CredentialGroupActorAccessStatement {
  return {
    sid: ACTOR_ACCESS_SID,
    effect: 'allow',
    actions: [CREDENTIAL_USE_ACTION],
    principals: [{ type: 'credential_group_actor' }],
    condition: {
      Bool: {
        [ACTOR_OWNS_CREDENTIAL_CONDITION_KEY]: true,
      },
    },
  }
}

export function createDefaultCredentialGroupPolicyDocument(
  credentialGroupId: string
): CredentialGroupWorkflowAccessPolicyDocument {
  return {
    version: 1,
    resource: {
      type: 'credential_group',
      id: requireCanonicalId(credentialGroupId, 'Credential Group ID'),
    },
    statements: [createCredentialGroupActorAccessStatement()],
  }
}

function isKnowledgeConnectorAccessStatement(
  statement: Record<string, unknown>
): statement is CredentialGroupKnowledgeConnectorAccessStatement {
  return (
    typeof statement.sid === 'string' &&
    statement.sid.startsWith(KNOWLEDGE_CONNECTOR_ACCESS_SID_PREFIX)
  )
}

export function parseCredentialGroupPolicyDocument(
  value: unknown,
  expectedResourceId: string
): CredentialGroupWorkflowAccessPolicyDocument {
  const canonicalResourceId = requireCanonicalId(expectedResourceId, 'Expected Credential Group ID')
  const document = requireRecord(value, 'Credential Group policy document')
  requireExactKeys(
    document,
    ['version', 'resource', 'statements'],
    'Credential Group policy document'
  )
  if (document.version !== 1) throw new Error('Credential Group policy version must be 1')

  const resource = requireRecord(document.resource, 'Credential Group policy resource')
  requireExactKeys(resource, ['type', 'id'], 'Credential Group policy resource')
  if (
    resource.type !== 'credential_group' ||
    requireCanonicalId(resource.id, 'Credential Group policy resource ID') !== canonicalResourceId
  ) {
    throw new Error('Credential Group policy resource does not match its canonical resource')
  }

  if (!Array.isArray(document.statements) || document.statements.length < 1) {
    throw new Error('Credential Group policy must contain its actor statement')
  }
  /**
   * Knowledge connectors that crawl through this group's options carry their
   * own statements after the actor and workflow ones. They are owned by the
   * knowledge module, so this canonicaliser passes them through untouched
   * rather than rewriting or dropping them.
   */
  const knowledgeStatements: CredentialGroupKnowledgeConnectorAccessStatement[] = []
  const ownStatements: unknown[] = []
  for (const statement of document.statements) {
    const record = requireRecord(statement, 'Credential Group statement')
    if (isKnowledgeConnectorAccessStatement(record)) knowledgeStatements.push(record)
    else ownStatements.push(statement)
  }
  if (ownStatements.length > 2) {
    throw new Error(
      'Credential Group policy must contain its actor statement and optional workflow statement'
    )
  }

  const actorStatement = requireRecord(ownStatements[0], 'Credential Group actor statement')
  requireExactKeys(
    actorStatement,
    ['sid', 'effect', 'actions', 'principals', 'condition'],
    'Credential Group actor statement'
  )
  if (actorStatement.sid !== ACTOR_ACCESS_SID) {
    throw new Error(`Credential Group actor statement SID must be ${ACTOR_ACCESS_SID}`)
  }
  if (actorStatement.effect !== 'allow') {
    throw new Error('Credential Group actor statement effect must be allow')
  }
  if (
    !Array.isArray(actorStatement.actions) ||
    actorStatement.actions.length !== 1 ||
    actorStatement.actions[0] !== CREDENTIAL_USE_ACTION
  ) {
    throw new Error(`Credential Group actor statement action must be ${CREDENTIAL_USE_ACTION}`)
  }
  if (!Array.isArray(actorStatement.principals) || actorStatement.principals.length !== 1) {
    throw new Error('Credential Group actor statement must contain its actor principal')
  }
  const actorPrincipal = requireRecord(
    actorStatement.principals[0],
    'Credential Group actor principal'
  )
  requireExactKeys(actorPrincipal, ['type'], 'Credential Group actor principal')
  if (actorPrincipal.type !== 'credential_group_actor') {
    throw new Error('Credential Group actor statement must target the Credential Group actor')
  }
  const actorCondition = requireRecord(actorStatement.condition, 'Credential Group actor condition')
  requireExactKeys(actorCondition, ['Bool'], 'Credential Group actor condition')
  const actorBool = requireRecord(actorCondition.Bool, 'Credential Group actor Bool condition')
  requireExactKeys(
    actorBool,
    [ACTOR_OWNS_CREDENTIAL_CONDITION_KEY],
    'Credential Group actor Bool condition'
  )
  if (actorBool[ACTOR_OWNS_CREDENTIAL_CONDITION_KEY] !== true) {
    throw new Error('Credential Group actor statement must require actor credential ownership')
  }

  const canonicalActorStatement = createCredentialGroupActorAccessStatement()
  if (ownStatements.length === 1) {
    return {
      version: 1,
      resource: { type: 'credential_group', id: canonicalResourceId },
      statements: [canonicalActorStatement, ...knowledgeStatements],
    }
  }

  const statement = requireRecord(ownStatements[1], 'Credential Group workflow statement')
  requireExactKeys(
    statement,
    ['sid', 'effect', 'actions', 'principals', 'condition'],
    'Credential Group workflow statement'
  )
  if (statement.sid !== WORKFLOW_ACCESS_SID) {
    throw new Error(`Credential Group workflow statement SID must be ${WORKFLOW_ACCESS_SID}`)
  }
  if (statement.effect !== 'allow') {
    throw new Error('Credential Group workflow statement effect must be allow')
  }
  if (
    !Array.isArray(statement.actions) ||
    statement.actions.length !== 1 ||
    statement.actions[0] !== CREDENTIAL_USE_ACTION
  ) {
    throw new Error(`Credential Group workflow statement action must be ${CREDENTIAL_USE_ACTION}`)
  }
  if (
    !Array.isArray(statement.principals) ||
    statement.principals.length === 0 ||
    statement.principals.length > CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT
  ) {
    throw new Error(
      `Credential Group workflow statement must contain 1-${CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT} principals`
    )
  }

  const principals = statement.principals.map((value, index) => {
    const principal = requireRecord(value, `Credential Group workflow principal ${index}`)
    requireExactKeys(
      principal,
      ['type', 'workflowId'],
      `Credential Group workflow principal ${index}`
    )
    if (principal.type !== 'workflow') {
      throw new Error(`Credential Group workflow principal ${index} must target a workflow`)
    }
    return {
      type: 'workflow' as const,
      workflowId: requireCanonicalId(
        principal.workflowId,
        `Credential Group workflow principal ${index} workflow ID`
      ),
    }
  })
  for (let index = 1; index < principals.length; index++) {
    if (principals[index - 1].workflowId >= principals[index].workflowId) {
      throw new Error('Credential Group workflow principals must be unique and sorted')
    }
  }

  const condition = requireRecord(statement.condition, 'Credential Group workflow condition')
  requireExactKeys(condition, ['StringEquals'], 'Credential Group workflow condition')
  const stringEquals = requireRecord(
    condition.StringEquals,
    'Credential Group workflow StringEquals condition'
  )
  requireExactKeys(
    stringEquals,
    [DEPLOYMENT_MODE_CONDITION_KEY],
    'Credential Group workflow StringEquals condition'
  )
  if (stringEquals[DEPLOYMENT_MODE_CONDITION_KEY] !== 'deployment') {
    throw new Error('Credential Group workflow statement must require deployed execution')
  }

  return {
    version: 1,
    resource: { type: 'credential_group', id: canonicalResourceId },
    statements: [
      canonicalActorStatement,
      {
        sid: WORKFLOW_ACCESS_SID,
        effect: 'allow',
        actions: [CREDENTIAL_USE_ACTION],
        principals,
        condition: {
          StringEquals: {
            [DEPLOYMENT_MODE_CONDITION_KEY]: 'deployment',
          },
        },
      },
      ...knowledgeStatements,
    ],
  }
}

/** Validates the org-only workspace sharing document without importing application code. */
export function validateOrganizationAccountPolicyDocument(
  value: unknown,
  expectedResourceId: string
): void {
  const document = requireRecord(value, 'Organization account policy')
  requireExactKeys(document, ['version', 'resource', 'statements'], 'Organization account policy')
  if (document.version !== 2) throw new Error('Organization account policy version must be 2')
  const resource = requireRecord(document.resource, 'Organization account resource')
  requireExactKeys(resource, ['type', 'id'], 'Organization account resource')
  if (
    resource.type !== 'credential_group' ||
    requireCanonicalId(resource.id, 'Organization account resource ID') !== expectedResourceId
  )
    throw new Error('Organization account policy resource does not match its canonical resource')
  if (!Array.isArray(document.statements) || document.statements.length > 1)
    throw new Error('Organization account policy supports only workspace access')
  if (document.statements.length === 0) return
  const statement = requireRecord(
    document.statements[0],
    'Organization account workspace statement'
  )
  requireExactKeys(
    statement,
    ['sid', 'effect', 'actions', 'principals'],
    'Organization account workspace statement'
  )
  if (
    statement.sid !== 'WorkspaceCredentialAccess' ||
    statement.effect !== 'allow' ||
    !Array.isArray(statement.actions) ||
    statement.actions.length !== 1 ||
    statement.actions[0] !== CREDENTIAL_USE_ACTION
  )
    throw new Error('Organization account workspace statement is invalid')
  if (
    !Array.isArray(statement.principals) ||
    statement.principals.length < 1 ||
    statement.principals.length > 1000
  )
    throw new Error('Organization account policy supports 1-1000 workspaces')
  let previous = ''
  for (const value of statement.principals) {
    const principal = requireRecord(value, 'Organization account workspace principal')
    requireExactKeys(principal, ['type', 'workspaceId'], 'Organization account workspace principal')
    const id = requireCanonicalId(principal.workspaceId, 'Organization account workspace ID')
    if (principal.type !== 'workspace' || id <= previous)
      throw new Error('Organization account workspace principals must be unique and sorted')
    previous = id
  }
}

function assertPage<T extends { id: string }>(
  rows: T[],
  afterId: string,
  batchSize: number,
  label: string
): string | null {
  if (rows.length === 0) return null
  if (rows.length > batchSize) throw new Error(`${label} returned an oversized page`)
  const lastId = rows.at(-1)?.id
  if (!lastId || lastId <= afterId) throw new Error(`${label} returned a non-advancing page`)
  return lastId
}

export async function reconcileCredentialGroupResourcePolicies(
  store: CredentialGroupPolicyLifecycleStore,
  options: ReconcileCredentialGroupPoliciesOptions = {}
): Promise<CredentialGroupPolicyReconciliationResult> {
  const batchSize = options.batchSize ?? CREDENTIAL_GROUP_POLICY_BATCH_SIZE
  if (
    !Number.isInteger(batchSize) ||
    batchSize <= 0 ||
    batchSize > CREDENTIAL_GROUP_POLICY_BATCH_SIZE
  ) {
    throw new Error(
      `Credential Group policy batch size must be between 1 and ${CREDENTIAL_GROUP_POLICY_BATCH_SIZE}`
    )
  }

  await store.installLifecycleTrigger()
  const result: CredentialGroupPolicyReconciliationResult = {
    scannedMissing: 0,
    inserted: 0,
    validated: 0,
  }

  let afterId = ''
  for (;;) {
    const rows = await store.listMissingPolicies(afterId, batchSize)
    const lastId = assertPage(rows, afterId, batchSize, 'Missing Credential Group policy store')
    if (!lastId) break
    result.scannedMissing += rows.length
    result.inserted += await store.insertDefaultPolicies(rows)
    afterId = lastId
  }

  const violation = await store.findRelationalInvariantViolation()
  if (violation) {
    throw new Error(
      `Credential Group policy invariant failed: ${violation.kind} policy for ${violation.resourceId}`
    )
  }

  afterId = ''
  for (;;) {
    const rows = await store.listPolicies(afterId, batchSize)
    const lastId = assertPage(rows, afterId, batchSize, 'Credential Group policy validation store')
    if (!lastId) break
    for (const row of rows) {
      if (!Number.isInteger(row.revision) || row.revision < 1) {
        throw new Error(`Credential Group policy ${row.id} has an invalid revision`)
      }
      const maxBytes = row.organizationId
        ? ORGANIZATION_ACCOUNT_POLICY_DOCUMENT_MAX_BYTES
        : CREDENTIAL_GROUP_POLICY_DOCUMENT_MAX_BYTES
      if (
        !Number.isInteger(row.documentBytes) ||
        row.documentBytes < 0 ||
        row.documentBytes > maxBytes
      ) {
        throw new Error(`Credential Group policy ${row.id} exceeds the ${maxBytes}-byte limit`)
      }
      if (row.organizationId) {
        if (row.workspaceId)
          throw new Error('Organization account policy cannot also belong to a workspace')
        validateOrganizationAccountPolicyDocument(row.document, row.resourceId)
      } else {
        if (!row.workspaceId) throw new Error('Credential group policy has no owner')
        parseCredentialGroupPolicyDocument(row.document, row.resourceId)
      }
    }
    result.validated += rows.length
    afterId = lastId
  }
  return result
}

export function createPostgresCredentialGroupPolicyLifecycleStore(
  sql: Sql
): CredentialGroupPolicyLifecycleStore {
  return {
    async installLifecycleTrigger() {
      await sql.begin(async (tx) => {
        await tx`SET LOCAL lock_timeout = '5s'`
        await tx`
          CREATE OR REPLACE FUNCTION "public"."sync_credential_group_resource_policy"()
          RETURNS trigger
          LANGUAGE plpgsql
          SET search_path = pg_catalog, public
          AS $$
          BEGIN
            IF TG_OP = 'INSERT' THEN
              IF NEW."workspace_id" IS NULL THEN
                RETURN NEW;
              END IF;
              INSERT INTO "public"."resource_policy" (
                "id",
                "workspace_id",
                "resource_type",
                "resource_id",
                "revision",
                "document",
                "created_by",
                "updated_by"
              )
              VALUES (
                gen_random_uuid()::text,
                NEW."workspace_id",
                'credential_group',
                NEW."id",
                1,
                jsonb_build_object(
                  'version', 1,
                  'resource', jsonb_build_object('type', 'credential_group', 'id', NEW."id"),
                  'statements', jsonb_build_array(
                    jsonb_build_object(
                      'sid', 'CredentialGroupActorCredentialAccess',
                      'effect', 'allow',
                      'actions', jsonb_build_array('credential_groups.credentials.use'),
                      'principals', jsonb_build_array(
                        jsonb_build_object('type', 'credential_group_actor')
                      ),
                      'condition', jsonb_build_object(
                        'Bool', jsonb_build_object(
                          'credential_group:ActorOwnsCredential', true
                        )
                      )
                    )
                  )
                ),
                NEW."created_by",
                NEW."created_by"
              );
              RETURN NEW;
            END IF;

            DELETE FROM "public"."resource_policy"
            WHERE ("workspace_id" = OLD."workspace_id" OR "organization_id" = OLD."organization_id")
              AND "resource_type" = 'credential_group'
              AND "resource_id" = OLD."id";
            RETURN OLD;
          END;
          $$
        `
        await tx`
          DROP TRIGGER IF EXISTS "credential_group_resource_policy_lifecycle"
          ON "public"."credential_group"
        `
        await tx`
          CREATE TRIGGER "credential_group_resource_policy_lifecycle"
          AFTER INSERT OR DELETE ON "public"."credential_group"
          FOR EACH ROW
          EXECUTE FUNCTION "public"."sync_credential_group_resource_policy"()
        `
      })
    },

    async listMissingPolicies(afterId, limit) {
      return sql<MissingCredentialGroupPolicyRow[]>`
        SELECT
          cg.id,
          cg.workspace_id AS "workspaceId",
          cg.created_by AS "createdBy"
        FROM credential_group cg
        WHERE cg.id > ${afterId}
          AND cg.workspace_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM resource_policy rp
            WHERE rp.resource_type = 'credential_group'
              AND rp.resource_id = cg.id
          )
        ORDER BY cg.id
        LIMIT ${limit}
      `
    },

    async insertDefaultPolicies(rows) {
      if (rows.length === 0) return 0
      if (rows.length > CREDENTIAL_GROUP_POLICY_BATCH_SIZE) {
        throw new Error('Credential Group policy insert exceeded the bounded batch size')
      }
      const ids = rows.map((row) => row.id)
      const inserted = await sql<Array<{ resourceId: string }>>`
        INSERT INTO resource_policy (
          id,
          workspace_id,
          resource_type,
          resource_id,
          revision,
          document,
          created_by,
          updated_by
        )
        SELECT
          gen_random_uuid()::text,
          cg.workspace_id,
          'credential_group',
          cg.id,
          1,
          jsonb_build_object(
            'version', 1,
            'resource', jsonb_build_object('type', 'credential_group', 'id', cg.id),
            'statements', jsonb_build_array(
              jsonb_build_object(
                'sid', 'CredentialGroupActorCredentialAccess',
                'effect', 'allow',
                'actions', jsonb_build_array('credential_groups.credentials.use'),
                'principals', jsonb_build_array(
                  jsonb_build_object('type', 'credential_group_actor')
                ),
                'condition', jsonb_build_object(
                  'Bool', jsonb_build_object(
                    'credential_group:ActorOwnsCredential', true
                  )
                )
              )
            )
          ),
          cg.created_by,
          cg.created_by
        FROM credential_group cg
        WHERE cg.id = ANY(${ids}::text[])
          AND cg.workspace_id IS NOT NULL
        ON CONFLICT (resource_type, resource_id) DO NOTHING
        RETURNING resource_id AS "resourceId"
      `
      return inserted.length
    },

    async findRelationalInvariantViolation() {
      const [violation] = await sql<CredentialGroupPolicyInvariantViolation[]>`
        SELECT kind, resource_id AS "resourceId"
        FROM (
          SELECT
            CASE
              WHEN rp.resource_id IS NULL THEN 'missing'
              ELSE 'workspace_mismatch'
            END AS kind,
            cg.id AS resource_id
          FROM credential_group cg
          LEFT JOIN resource_policy rp
            ON rp.resource_type = 'credential_group'
            AND rp.resource_id = cg.id
          WHERE rp.resource_id IS NULL
              OR rp.workspace_id IS DISTINCT FROM cg.workspace_id
              OR rp.organization_id IS DISTINCT FROM cg.organization_id

          UNION ALL

          SELECT 'orphan' AS kind, rp.resource_id
          FROM resource_policy rp
          LEFT JOIN credential_group cg ON cg.id = rp.resource_id
          WHERE rp.resource_type = 'credential_group'
            AND cg.id IS NULL
        ) violations
        ORDER BY resource_id
        LIMIT 1
      `
      return violation ?? null
    },

    async listPolicies(afterId, limit) {
      return sql<StoredCredentialGroupPolicyRow[]>`
        SELECT
          id,
          workspace_id AS "workspaceId",
          organization_id AS "organizationId",
          resource_id AS "resourceId",
          revision,
          octet_length(document::text)::integer AS "documentBytes",
          CASE
            WHEN octet_length(document::text) <= CASE
              WHEN organization_id IS NULL THEN ${CREDENTIAL_GROUP_POLICY_DOCUMENT_MAX_BYTES}::integer
              ELSE ${ORGANIZATION_ACCOUNT_POLICY_DOCUMENT_MAX_BYTES}::integer
            END
            THEN document
            ELSE NULL
          END AS document
        FROM resource_policy
        WHERE resource_type = 'credential_group'
          AND id > ${afterId}
        ORDER BY id
        LIMIT ${limit}
      `
    },
  }
}
