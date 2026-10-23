import type { Sql, TransactionSql } from 'postgres'

const STATE = 'public.search_retirement_state'
const SHADOW = 'public.embedding_search_retirement_shadow'
const BACKUP = 'public.embedding_search_retirement_backup'
const JOB_LOCK = 'sim:search-retirement-replacement'
const MAINTENANCE_LOCK = 'sim:search-retirement-maintenance'
const MIGRATION_LOCK = '4961002270'
const WIDTHS = [1536, 384, 512, 768, 1024, 3072] as const
const SOURCE_WIDTHS = [1536, 384, 768, 1024, 3072] as const
const column = (prefix: string, width: number) => (width === 1536 ? prefix : `${prefix}_${width}`)
const VECTOR_COLUMNS = WIDTHS.map((width) => column('vector', width))
const BINARY_COLUMNS = SOURCE_WIDTHS.map((width) => column('binary', width))
const PROJECTED_COLUMNS = [
  'id',
  'knowledge_base_id',
  'document_id',
  'enabled',
  ...BINARY_COLUMNS,
  ...VECTOR_COLUMNS,
]
const SHARED_INDEXES = [
  { name: 'embedding_search_pkey', suffix: 'pkey', definition: 'UNIQUE (id)' },
  { name: 'embedding_search_kb_idx', suffix: 'kb_idx', definition: '(knowledge_base_id)' },
  {
    name: 'embedding_search_document_lookup_idx',
    suffix: 'document_lookup_idx',
    definition: '(document_id, knowledge_base_id, id) WHERE enabled',
  },
  ...WIDTHS.map((width) => ({
    name:
      width === 1536
        ? 'embedding_search_cosine_hnsw_idx'
        : `embedding_search_${width}_cosine_hnsw_idx`,
    suffix: `${width}_hnsw_idx`,
    definition: `USING hnsw (${column('vector', width)} halfvec_cosine_ops) WITH (m = 16, ef_construction = 64)`,
  })),
] as const

export type SearchRetirementPhase =
  | 'snapshot'
  | 'copy'
  | 'catchup'
  | 'validate-source'
  | 'validate-shadow'
  | 'ready'
  | 'cutover'
  | 'purge'
  | 'documents'
  | 'finalize'
  | 'done'

/** Deliberate operator messages never include database values, IDs, or statement parameters. */
export class SearchRetirementError extends Error {
  override name = 'SearchRetirementError'
}

export interface SearchRetirementStatus {
  phase: SearchRetirementPhase
  invalidated: boolean
  invalidationReason: string | null
  sourceScanned: number
  copied: number
  reconciled: number
  validatedSource: number
  validatedShadow: number
  purgedEmbeddings: number
  retiredDocuments: number
  pendingChanges: boolean
  changeBacklogAtLimit: boolean
  backupRetained: boolean
}

interface StateRow {
  version: number
  phase: SearchRetirementPhase
  resume_phase: 'validate-source' | 'ready'
  after_id: string
  invalidated: boolean
  invalidation_reason: string | null
  original_oid: number
  replacement_oid: number
  source_scanned: string
  copied: string
  reconciled: string
  validated_source: string
  validated_shadow: string
  purged_embeddings: string
  retired_documents: string
  round_mutations: string
  ready_at: Date | null
}

interface PageResult {
  after_id: string | null
  scanned: number
  changed: number
}

const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`
const columns = PROJECTED_COLUMNS.map(identifier).join(', ')
const assignments = PROJECTED_COLUMNS.filter((name) => name !== 'id')
  .map((name) => `${identifier(name)} = EXCLUDED.${identifier(name)}`)
  .join(', ')
const comparison = (left: string, right: string) =>
  `(${PROJECTED_COLUMNS.map((name) => `${left}.${identifier(name)}`).join(', ')}) IS DISTINCT FROM (${PROJECTED_COLUMNS.map((name) => `${right}.${identifier(name)}`).join(', ')})`

const REPLACEMENT_SHAPE = `SELECT jsonb_build_object(
  'columns', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attnum) FROM (
    SELECT a.attnum, a.attname, a.atttypid, a.atttypmod, a.attnotnull, a.attidentity,
      a.attgenerated, a.attcollation, a.attacl, pg_get_expr(d.adbin, d.adrelid) AS default_value
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum LIMIT 32
  ) a),
  'constraints', (SELECT jsonb_agg(to_jsonb(k) ORDER BY k.conname) FROM (
    SELECT conname, contype, convalidated, condeferrable, condeferred, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE conrelid = c.oid ORDER BY conname LIMIT 32
  ) k),
  'table', jsonb_build_array(c.relkind, c.relpersistence, c.relrowsecurity,
    c.relforcerowsecurity, c.relreplident, c.reloptions, c.reltablespace),
  'unexpected_dependencies', EXISTS (SELECT 1 FROM pg_constraint WHERE confrelid = c.oid)
    OR EXISTS (SELECT 1 FROM pg_depend WHERE refobjid = c.oid
      AND refclassid = 'pg_class'::regclass
      AND classid IN ('pg_rewrite'::regclass, 'pg_proc'::regclass, 'pg_policy'::regclass))
    OR EXISTS (SELECT 1 FROM pg_inherits WHERE inhrelid = c.oid OR inhparent = c.oid)
    OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = c.oid)
    OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = c.oid AND NOT tgisinternal)
    OR EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public'
      AND tablename = 'embedding_search_retirement_shadow')
) FROM pg_class c WHERE c.oid = 'public.embedding_search_retirement_shadow'::regclass`

/** Matches the current synchronous writer, including OpenAI's 512-dimensional prefix. */
function projectedValues(source: string, model: string): string {
  const shortened = `${model} IN ('text-embedding-3-small', 'text-embedding-3-large') AND ${source}.embedding_384 IS NULL`
  return [
    `${source}.id`,
    `${source}.knowledge_base_id`,
    `${source}.document_id`,
    `${source}.enabled`,
    ...SOURCE_WIDTHS.map(
      (width) =>
        `binary_quantize(${source}.${column('embedding', width)})::bit(${width}) AS ${identifier(column('binary', width))}`
    ),
    ...WIDTHS.map((width) =>
      width === 512
        ? `CASE WHEN ${shortened} THEN subvector(coalesce(${SOURCE_WIDTHS.map((size) => `${source}.${column('embedding', size)}`).join(', ')}), 1, 512)::halfvec(512) END AS vector_512`
        : `CASE WHEN NOT (${shortened}) THEN ${source}.${column('embedding', width)}::halfvec(${width}) END AS ${column('vector', width)}`
    ),
  ].join(', ')
}

async function relationExists(tx: Sql | TransactionSql, name: string): Promise<boolean> {
  const [row] = await tx<{ present: boolean }[]>`SELECT to_regclass(${name}) IS NOT NULL AS present`
  return row.present
}

async function stateOf(tx: Sql | TransactionSql): Promise<StateRow> {
  const [row] = await tx<StateRow[]>`SELECT * FROM public.search_retirement_state WHERE id = 1`
  if (!row || row.version !== 1)
    throw new SearchRetirementError('Unrecognized retirement state; no changes were made')
  return row
}

async function statusOf(tx: Sql | TransactionSql): Promise<SearchRetirementStatus> {
  const state = await stateOf(tx)
  const [relations] = await tx<{ pending: boolean; backlog: boolean; backup: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM public.search_retirement_changes) AS pending,
      EXISTS (SELECT 1 FROM public.search_retirement_changes OFFSET 10000 LIMIT 1) AS backlog,
      to_regclass('public.embedding_search_retirement_backup') IS NOT NULL AS backup`
  return {
    phase: state.phase,
    invalidated: state.invalidated,
    invalidationReason: state.invalidation_reason,
    sourceScanned: Number(state.source_scanned),
    copied: Number(state.copied),
    reconciled: Number(state.reconciled),
    validatedSource: Number(state.validated_source),
    validatedShadow: Number(state.validated_shadow),
    purgedEmbeddings: Number(state.purged_embeddings),
    retiredDocuments: Number(state.retired_documents),
    pendingChanges: relations.pending,
    changeBacklogAtLimit: relations.backlog,
    backupRetained: relations.backup,
  }
}

/** Read-only: inspecting an uninitialized database never creates maintenance objects. */
export async function getSearchRetirementStatus(sql: Sql): Promise<SearchRetirementStatus | null> {
  if (!(await relationExists(sql, STATE))) return null
  return statusOf(sql)
}

async function operation<T>(
  sql: Sql,
  work: (tx: TransactionSql) => Promise<T>,
  ddl = false
): Promise<T> {
  return sql.begin('isolation level read committed', async (tx) => {
    const [version] = await tx<{ supported: boolean }[]>`
      SELECT current_setting('server_version_num')::int >= 170000 AS supported`
    if (!version.supported)
      throw new SearchRetirementError(
        'Retirement requires PostgreSQL 17 or newer for a bounded transaction deadline'
      )
    await tx.unsafe("SET LOCAL transaction_timeout = '3s'")
    await tx.unsafe(`SET LOCAL statement_timeout = '${ddl ? '5s' : '2s'}'`)
    await tx.unsafe("SET LOCAL lock_timeout = '100ms'")
    await tx.unsafe('SET LOCAL search_path = pg_catalog, public')
    const [locks] = await tx<{ job: boolean; maintenance: boolean; migration: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${JOB_LOCK}, 0)) AS job,
        pg_try_advisory_xact_lock(hashtextextended(${MAINTENANCE_LOCK}, 0)) AS maintenance,
        pg_try_advisory_xact_lock(${MIGRATION_LOCK}::bigint) AS migration`
    if (!locks.job || !locks.maintenance || !locks.migration) {
      throw new SearchRetirementError(
        'Another migration or retirement operation is active; retry later'
      )
    }
    if (await relationExists(tx, 'public.search_embedding_cleanup_progress')) {
      await tx`SELECT id FROM public.search_embedding_cleanup_progress WHERE id = 1 FOR UPDATE NOWAIT`
    }
    return work(tx)
  }) as Promise<T>
}

function requireValid(state: StateRow): void {
  if (state.invalidated) {
    if (['cutover', 'purge', 'documents', 'finalize', 'done'].includes(state.phase)) {
      throw new SearchRetirementError(
        'A captured target changed after cutover; investigate its scope before resuming. Retirement state is preserved'
      )
    }
    throw new SearchRetirementError(
      'Knowledge-base indexing metadata changed; abort and prepare a new replacement'
    )
  }
}

async function verifyRelationIdentity(tx: TransactionSql, state: StateRow): Promise<void> {
  const swapped = ['cutover', 'purge', 'documents', 'finalize', 'done'].includes(state.phase)
  const [row] = await tx<{ active: number; shadow: number | null; backup: number | null }[]>`
    SELECT to_regclass('public.embedding_search')::oid AS active,
      to_regclass('public.embedding_search_retirement_shadow')::oid AS shadow,
      to_regclass('public.embedding_search_retirement_backup')::oid AS backup`
  if (
    row.active !== (swapped ? state.replacement_oid : state.original_oid) ||
    (!swapped && row.shadow !== state.replacement_oid) ||
    (state.phase === 'cutover' && row.backup !== state.original_oid)
  ) {
    throw new SearchRetirementError(
      'Retirement relation identity changed; refusing to adopt or replace it'
    )
  }
}

/** Catalog checks are bounded and reject dependencies that a name swap would strand on the old OID. */
async function inspectProjection(tx: TransactionSql): Promise<void> {
  const [relation] = await tx<{ safe: boolean }[]>`
    SELECT c.relkind = 'r' AND c.relpersistence = 'p' AND NOT c.relrowsecurity
      AND NOT c.relforcerowsecurity
      AND NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = c.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = c.oid AND attacl IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE confrelid = c.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_depend WHERE refobjid = c.oid
        AND refclassid = 'pg_class'::regclass
        AND classid IN ('pg_rewrite'::regclass, 'pg_proc'::regclass, 'pg_policy'::regclass))
      AND NOT EXISTS (SELECT 1 FROM pg_inherits WHERE inhrelid = c.oid OR inhparent = c.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
        WHERE schemaname = 'public' AND tablename IN ('embedding', 'embedding_search', 'knowledge_base'))
      AS safe
    FROM pg_class c WHERE c.oid = 'public.embedding_search'::regclass`
  if (!relation?.safe)
    throw new SearchRetirementError(
      'Projection dependencies, publication, or row security require a separate migration'
    )
  const [constraints] = await tx<{ safe: boolean }[]>`
    SELECT NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.embedding_search'::regclass
      AND NOT (
        (c.contype = 'p' AND c.conkey = ARRAY[1]::smallint[])
        OR (c.contype = 'f' AND c.conkey = ARRAY[1]::smallint[]
          AND c.confrelid = 'public.embedding'::regclass AND c.confkey = ARRAY[1]::smallint[]
          AND c.confdeltype = 'c' AND c.confupdtype = 'a')
        OR (c.contype = 'c' AND c.conname = 'embedding_search_width_check')
        OR c.contype = 'n'
      )) AS safe`
  if (!constraints.safe)
    throw new SearchRetirementError(
      'Projection constraints differ from the reviewed compatible shape'
    )
  const actual = await tx<{ name: string; type: string; required: boolean }[]>`
    SELECT attname AS name, format_type(atttypid, atttypmod) AS type, attnotnull AS required
    FROM pg_attribute WHERE attrelid = 'public.embedding_search'::regclass
      AND attnum > 0 AND NOT attisdropped ORDER BY attnum LIMIT 32`
  const expected = new Map([
    ['id', 'text:true'],
    ['knowledge_base_id', 'text:true'],
    ['document_id', 'text:true'],
    ['enabled', 'boolean:true'],
    ['connector_id', 'text:false'],
    ['acl', 'text[]:false'],
    ...SOURCE_WIDTHS.map((width) => [column('binary', width), `bit(${width}):false`] as const),
    ...WIDTHS.map((width) => [column('vector', width), `halfvec(${width}):false`] as const),
  ])
  if (
    actual.length !== expected.size ||
    actual.some((entry) => expected.get(entry.name) !== `${entry.type}:${entry.required}`)
  ) {
    throw new SearchRetirementError('Projection columns differ from the reviewed compatible shape')
  }
  const [triggers] = await tx<{ unknown: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgrelid = 'public.embedding_search'::regclass AND NOT t.tgisinternal
        AND (t.tgname <> 'embedding_search_source_acl_set' OR p.proname <> 'set_projection_source_acl'
          OR p.pronamespace <> 'public'::regnamespace OR t.tgenabled <> 'O')) AS unknown`
  if (triggers.unknown)
    throw new SearchRetirementError(
      'Projection has an unrecognized trigger; no replacement was prepared'
    )
  const [writer] = await tx<{ safe: boolean; guard: string | null }[]>`
    SELECT t.tgenabled = 'O' AND t.tgtype = 21 AND t.tgnargs = 0
      AND t.tgfoid = to_regprocedure('public.sync_embedding_search()')
      AND ARRAY(SELECT a.attname::text FROM pg_attribute a
        WHERE a.attrelid = t.tgrelid AND a.attnum = ANY(t.tgattr) ORDER BY a.attname)
        = ARRAY['document_id', 'embedding', 'embedding_1024', 'embedding_3072',
            'embedding_384', 'embedding_768', 'enabled', 'knowledge_base_id']::text[] AS safe,
      pg_get_expr(t.tgqual, t.tgrelid) AS guard
    FROM pg_trigger t WHERE t.tgrelid = 'public.embedding'::regclass
      AND t.tgname = 'embedding_search_sync' AND NOT t.tgisinternal`
  const guard = writer?.guard?.replace(/[\s()]/g, '')
  const setting = "current_setting'sim.projection_mode'::text,true"
  if (
    !writer?.safe ||
    (guard &&
      ![
        `${setting}ISDISTINCTFROM'async'::text`,
        `NOT${setting}ISNOTDISTINCTFROM'async'::text`,
        `NOTNOT${setting}ISDISTINCTFROM'async'::text`,
      ].includes(guard))
  ) {
    throw new SearchRetirementError(
      'Canonical vector synchronization trigger differs from the reviewed writer'
    )
  }
}

async function clonePrivileges(tx: TransactionSql): Promise<void> {
  const [owner] = await tx<{ name: string }[]>`
    SELECT pg_get_userbyid(relowner) AS name FROM pg_class WHERE oid = 'public.embedding_search'::regclass`
  await tx.unsafe(`ALTER TABLE ${SHADOW} OWNER TO ${identifier(owner.name)}`)
  const previousGrants = await tx<{ role: string }[]>`
    SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS role
    FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    WHERE c.oid = 'public.embedding_search_retirement_shadow'::regclass AND a.grantee <> c.relowner LIMIT 129`
  if (previousGrants.length > 128)
    throw new SearchRetirementError(
      'Default table privileges exceed the reviewed maintenance bound'
    )
  for (const grant of previousGrants) {
    await tx.unsafe(
      `REVOKE ALL PRIVILEGES ON TABLE ${SHADOW} FROM ${grant.role === 'PUBLIC' ? 'PUBLIC' : identifier(grant.role)}`
    )
  }
  const grants = await tx<{ role: string; privilege: string; grantable: boolean }[]>`
    SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS role,
      a.privilege_type AS privilege, a.is_grantable AS grantable
    FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    WHERE c.oid = 'public.embedding_search'::regclass AND a.grantee <> c.relowner LIMIT 129`
  if (grants.length > 128)
    throw new SearchRetirementError(
      'Projection privilege set exceeds the reviewed maintenance bound'
    )
  for (const grant of grants) {
    if (
      ![
        'SELECT',
        'INSERT',
        'UPDATE',
        'DELETE',
        'TRUNCATE',
        'REFERENCES',
        'TRIGGER',
        'MAINTAIN',
      ].includes(grant.privilege)
    ) {
      throw new SearchRetirementError('Projection has an unrecognized privilege')
    }
    await tx.unsafe(
      `GRANT ${grant.privilege} ON TABLE ${SHADOW} TO ${grant.role === 'PUBLIC' ? 'PUBLIC' : identifier(grant.role)}${grant.grantable ? ' WITH GRANT OPTION' : ''}`
    )
  }
}

async function installCapture(tx: TransactionSql): Promise<void> {
  await tx.unsafe(`CREATE FUNCTION public.capture_search_retirement_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    BEGIN
      IF TG_OP <> 'INSERT' THEN
        INSERT INTO public.search_retirement_changes (embedding_id) VALUES (OLD.id)
        ON CONFLICT (embedding_id) DO UPDATE SET generation = search_retirement_changes.generation + 1;
      END IF;
      IF TG_OP <> 'DELETE' AND (TG_OP <> 'UPDATE' OR OLD.id IS DISTINCT FROM NEW.id) THEN
        INSERT INTO public.search_retirement_changes (embedding_id) VALUES (NEW.id)
        ON CONFLICT (embedding_id) DO UPDATE SET generation = search_retirement_changes.generation + 1;
      END IF;
      RETURN NULL;
    END $$`)
  await tx.unsafe(`CREATE TRIGGER search_retirement_capture AFTER INSERT OR UPDATE OR DELETE
    ON public.embedding FOR EACH ROW EXECUTE FUNCTION public.capture_search_retirement_change()`)
  await tx.unsafe(`CREATE FUNCTION public.invalidate_search_retirement() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    BEGIN
      UPDATE public.search_retirement_state SET invalidated = true,
        invalidation_reason = 'knowledge-base-metadata-changed' WHERE id = 1;
      RETURN NULL;
    END $$`)
  await tx.unsafe(`CREATE TRIGGER search_retirement_invalidate
    AFTER UPDATE OF is_search_index, embedding_model, embedding_dimension ON public.knowledge_base
    FOR EACH ROW WHEN (OLD.is_search_index IS DISTINCT FROM NEW.is_search_index
      OR OLD.embedding_model IS DISTINCT FROM NEW.embedding_model
      OR OLD.embedding_dimension IS DISTINCT FROM NEW.embedding_dimension)
    EXECUTE FUNCTION public.invalidate_search_retirement()`)
  if (await relationExists(tx, 'public.search_embedding_cleanup_progress')) {
    await tx.unsafe(
      'LOCK TABLE public.search_embedding_cleanup_progress IN SHARE ROW EXCLUSIVE MODE NOWAIT'
    )
    await tx.unsafe(`CREATE FUNCTION public.guard_legacy_search_retirement() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        RAISE EXCEPTION 'Legacy cleanup is fenced by replacement retirement' USING ERRCODE = '55000';
      END $$`)
    await tx.unsafe(`CREATE TRIGGER search_retirement_legacy_guard BEFORE INSERT OR UPDATE OR DELETE
      ON public.search_embedding_cleanup_progress FOR EACH ROW
      EXECUTE FUNCTION public.guard_legacy_search_retirement()`)
  }
}

/** Only empty-object DDL runs here. Copying, validation, cutover, and deletion require separate calls. */
export async function initializeSearchRetirement(sql: Sql): Promise<SearchRetirementStatus> {
  return operation(
    sql,
    async (tx) => {
      if (await relationExists(tx, STATE)) {
        const state = await stateOf(tx)
        await verifyRelationIdentity(tx, state)
        return statusOf(tx)
      }
      await tx.unsafe(
        'LOCK TABLE public.knowledge_base, public.embedding IN SHARE ROW EXCLUSIVE MODE NOWAIT'
      )
      await tx.unsafe('LOCK TABLE public.embedding_search IN ACCESS SHARE MODE NOWAIT')
      await inspectProjection(tx)
      for (const relation of [
        SHADOW,
        BACKUP,
        'public.search_retirement_targets',
        'public.search_retirement_changes',
      ]) {
        if (await relationExists(tx, relation))
          throw new SearchRetirementError(
            'Unowned retirement objects already exist; refusing to replace them'
          )
      }
      await tx.unsafe(`CREATE TABLE ${STATE} (
      id integer PRIMARY KEY CHECK (id = 1), version integer NOT NULL CHECK (version = 1),
      phase text NOT NULL, resume_phase text NOT NULL DEFAULT 'validate-source', after_id text NOT NULL DEFAULT '',
      invalidated boolean NOT NULL DEFAULT false, invalidation_reason text,
      original_oid oid NOT NULL, replacement_oid oid NOT NULL,
      source_scanned bigint NOT NULL DEFAULT 0, copied bigint NOT NULL DEFAULT 0,
      reconciled bigint NOT NULL DEFAULT 0, validated_source bigint NOT NULL DEFAULT 0,
      validated_shadow bigint NOT NULL DEFAULT 0, purged_embeddings bigint NOT NULL DEFAULT 0,
      retired_documents bigint NOT NULL DEFAULT 0, round_mutations bigint NOT NULL DEFAULT 0
      , ready_at timestamptz, index_manifest jsonb NOT NULL DEFAULT '{}', relation_manifest jsonb NOT NULL DEFAULT '{}'
    )`)
      await tx.unsafe(
        'CREATE TABLE public.search_retirement_targets (knowledge_base_id text PRIMARY KEY)'
      )
      await tx.unsafe(
        'CREATE TABLE public.search_retirement_changes (embedding_id text PRIMARY KEY, generation bigint NOT NULL DEFAULT 1)'
      )
      await tx.unsafe(
        `CREATE TABLE ${SHADOW} (LIKE public.embedding_search INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING CONSTRAINTS INCLUDING STORAGE)`
      )
      await tx.unsafe(`ALTER TABLE ${SHADOW} ADD CONSTRAINT embedding_search_retirement_shadow_pkey PRIMARY KEY (id),
      ADD CONSTRAINT embedding_search_retirement_shadow_embedding_fk FOREIGN KEY (id) REFERENCES public.embedding(id) ON DELETE CASCADE`)
      for (const index of SHARED_INDEXES.slice(1)) {
        await tx.unsafe(
          `CREATE INDEX ${identifier(`embedding_search_retirement_shadow_${index.suffix}`)} ON ${SHADOW} ${index.definition}`
        )
      }
      await clonePrivileges(tx)
      await tx`INSERT INTO public.search_retirement_state (id, version, phase, original_oid, replacement_oid)
      VALUES (1, 1, 'snapshot', 'public.embedding_search'::regclass, 'public.embedding_search_retirement_shadow'::regclass)`
      await tx`UPDATE public.search_retirement_state SET index_manifest = (
      SELECT jsonb_object_agg(c.relname, pg_get_indexdef(i.indexrelid)) FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid WHERE i.indrelid = 'public.embedding_search_retirement_shadow'::regclass
    ) WHERE id = 1`
      await tx.unsafe(`UPDATE ${STATE} SET relation_manifest = (${REPLACEMENT_SHAPE}) WHERE id = 1`)
      await installCapture(tx)
      return statusOf(tx)
    },
    true
  )
}

async function copyPage(
  tx: TransactionSql,
  state: StateRow,
  pageSize: number
): Promise<PageResult> {
  const [page] = await tx.unsafe<PageResult[]>(
    `WITH page AS MATERIALIZED (
      SELECT id FROM public.embedding WHERE id > $1 ORDER BY id LIMIT $2
    ), expected AS MATERIALIZED (
      SELECT ${projectedValues('e', 'k.embedding_model')} FROM page p
      JOIN public.embedding e ON e.id = p.id JOIN public.knowledge_base k ON k.id = e.knowledge_base_id
      WHERE NOT k.is_search_index
    ), written AS (
      INSERT INTO ${SHADOW} AS s (${columns}) SELECT ${columns} FROM expected
      ON CONFLICT (id) DO UPDATE SET ${assignments} WHERE ${comparison('s', 'EXCLUDED')}
      RETURNING 1
    ) SELECT max(id) AS after_id, count(*)::int AS scanned,
      (SELECT count(*)::int FROM written) AS changed FROM page`,
    [state.after_id, pageSize]
  )
  return page
}

/** Read a generation before source state; a newer committed write keeps its queue entry for retry. */
async function reconcilePage(tx: TransactionSql, pageSize: number): Promise<number> {
  const queued = await tx<{ embedding_id: string; generation: string }[]>`
    SELECT embedding_id, generation::text FROM public.search_retirement_changes ORDER BY embedding_id LIMIT ${pageSize}`
  if (queued.length === 0) return 0
  const ids = queued.map((row) => row.embedding_id)
  await tx.unsafe(
    `WITH expected AS MATERIALIZED (
      SELECT ${projectedValues('e', 'k.embedding_model')} FROM public.embedding e
      JOIN public.knowledge_base k ON k.id = e.knowledge_base_id
      WHERE e.id = ANY($1::text[]) AND NOT k.is_search_index
    ) INSERT INTO ${SHADOW} AS s (${columns}) SELECT ${columns} FROM expected
      ON CONFLICT (id) DO UPDATE SET ${assignments} WHERE ${comparison('s', 'EXCLUDED')}`,
    [ids]
  )
  await tx.unsafe(
    `DELETE FROM ${SHADOW} s WHERE s.id = ANY($1::text[]) AND NOT EXISTS (
    SELECT 1 FROM public.embedding e JOIN public.knowledge_base k ON k.id = e.knowledge_base_id
    WHERE e.id = s.id AND NOT k.is_search_index)`,
    [ids]
  )
  await tx`DELETE FROM public.search_retirement_changes q USING
    unnest(${ids}::text[], ${queued.map((row) => row.generation)}::bigint[]) AS done(id, generation)
    WHERE q.embedding_id = done.id AND q.generation = done.generation`
  return queued.length
}

async function validatePage(
  tx: TransactionSql,
  state: StateRow,
  pageSize: number
): Promise<PageResult> {
  const source = state.phase === 'validate-source'
  const [page] = await tx.unsafe<(PageResult & { invalid: boolean })[]>(
    `WITH page AS MATERIALIZED (
      SELECT id FROM ${source ? 'public.embedding' : SHADOW} WHERE id > $1 ORDER BY id LIMIT $2
    ), expected AS MATERIALIZED (
      SELECT ${projectedValues('e', 'k.embedding_model')} FROM page p
      JOIN public.embedding e ON e.id = p.id JOIN public.knowledge_base k ON k.id = e.knowledge_base_id
      WHERE NOT k.is_search_index
    ) SELECT max(p.id) AS after_id, count(*)::int AS scanned, 0 AS changed,
      coalesce(bool_or(NOT EXISTS (SELECT 1 FROM public.search_retirement_changes q WHERE q.embedding_id = p.id)
        AND ${source ? `e.id IS NOT NULL AND (s.id IS NULL OR ${comparison('s', 'e')})` : `(e.id IS NULL OR ${comparison('s', 'e')})`}), false) AS invalid
      FROM page p LEFT JOIN expected e ON e.id = p.id LEFT JOIN ${SHADOW} s ON s.id = p.id`,
    [state.after_id, pageSize]
  )
  if (page.invalid)
    throw new SearchRetirementError(
      'Replacement validation found an uncaptured mismatch; cutover is not permitted'
    )
  return page
}

async function transition(tx: TransactionSql, phase: SearchRetirementPhase): Promise<void> {
  await tx`UPDATE public.search_retirement_state SET phase = ${phase}, after_id = '', round_mutations = 0 WHERE id = 1`
}

/** Late writes retain their generation until the corresponding canonical row is safely retired. */
async function purgeCapturedPage(tx: TransactionSql, pageSize: number): Promise<boolean> {
  const queued = await tx<{ embedding_id: string; generation: string }[]>`
    SELECT embedding_id, generation::text FROM public.search_retirement_changes
    ORDER BY embedding_id LIMIT ${Math.min(pageSize, 25)}`
  if (queued.length === 0) return false
  const ids = queued.map((row) => row.embedding_id)
  const [page] = await tx<{ changed: number; invalid: boolean }[]>`
    WITH targets AS MATERIALIZED (
      SELECT e.id, e.knowledge_base_id FROM public.embedding e
      JOIN public.search_retirement_targets t ON t.knowledge_base_id = e.knowledge_base_id
      WHERE e.id = ANY(${ids}::text[])
    ), bases AS MATERIALIZED (
      SELECT k.id, k.is_search_index FROM public.knowledge_base k
      WHERE k.id IN (SELECT knowledge_base_id FROM targets) ORDER BY k.id FOR SHARE OF k
    ), changed AS (
      DELETE FROM public.embedding e USING targets t, bases b
      WHERE e.id = t.id AND e.knowledge_base_id = t.knowledge_base_id
        AND b.id = t.knowledge_base_id AND b.is_search_index RETURNING e.id
    ) SELECT (SELECT count(*)::int FROM changed) AS changed,
      EXISTS (SELECT 1 FROM targets t LEFT JOIN bases b ON b.id = t.knowledge_base_id
        WHERE b.id IS NULL OR NOT b.is_search_index) AS invalid`
  if (page.invalid)
    throw new SearchRetirementError(
      'A captured cleanup target is no longer Search-marked; no page was committed'
    )
  await tx`DELETE FROM public.search_retirement_changes q USING
    unnest(${ids}::text[], ${queued.map((row) => row.generation)}::bigint[]) AS done(id, generation)
    WHERE q.embedding_id = done.id AND q.generation = done.generation`
  await tx`UPDATE public.search_retirement_state SET purged_embeddings = purged_embeddings + ${page.changed}
    WHERE id = 1`
  return true
}

async function removeCapture(tx: TransactionSql): Promise<void> {
  // Trigger removal can upgrade its relation lock; refuse a busy reader within one millisecond.
  await tx.unsafe("SET LOCAL lock_timeout = '1ms'")
  await tx.unsafe('DROP TRIGGER search_retirement_capture ON public.embedding')
  await tx.unsafe('DROP TRIGGER search_retirement_invalidate ON public.knowledge_base')
  await tx.unsafe(
    'DROP FUNCTION public.capture_search_retirement_change(), public.invalidate_search_retirement()'
  )
}

async function purgePage(tx: TransactionSql, state: StateRow, pageSize: number): Promise<void> {
  if (await purgeCapturedPage(tx, pageSize)) {
    if (state.phase === 'documents') await transition(tx, 'purge')
    return
  }
  const documents = state.phase === 'documents'
  const mutation = documents
    ? `UPDATE public.document d SET user_excluded = true, enabled = false, processing_queue_token = NULL,
         processing_queued_at = NULL, processing_deferred_until = NULL
       FROM targets t WHERE d.id = t.id AND d.knowledge_base_id = t.knowledge_base_id
         AND (NOT d.user_excluded OR d.enabled OR d.processing_queue_token IS NOT NULL
           OR d.processing_queued_at IS NOT NULL OR d.processing_deferred_until IS NOT NULL) RETURNING d.id`
    : `DELETE FROM public.embedding e USING targets t
       WHERE e.id = t.id AND e.knowledge_base_id = t.knowledge_base_id RETURNING e.id`
  const [page] = await tx.unsafe<(PageResult & { invalid: boolean })[]>(
    `WITH page AS MATERIALIZED (
      SELECT id, knowledge_base_id FROM public.${documents ? 'document' : 'embedding'}
      WHERE id > $1 ORDER BY id LIMIT $2
    ), targets AS MATERIALIZED (
      SELECT p.* FROM page p JOIN public.search_retirement_targets t ON t.knowledge_base_id = p.knowledge_base_id
    ), bases AS MATERIALIZED (
      SELECT k.id, k.is_search_index FROM public.knowledge_base k
      WHERE k.id IN (SELECT knowledge_base_id FROM targets) ORDER BY k.id FOR SHARE OF k
    ), safe_targets AS MATERIALIZED (
      SELECT t.* FROM targets t JOIN bases b ON b.id = t.knowledge_base_id WHERE b.is_search_index
    ), changed AS (${mutation.replace('FROM targets t', 'FROM safe_targets t').replace('USING targets t', 'USING safe_targets t')})
    SELECT max(id) AS after_id, count(*)::int AS scanned,
      (SELECT count(*)::int FROM changed) AS changed,
      EXISTS (SELECT 1 FROM targets t LEFT JOIN bases b ON b.id = t.knowledge_base_id
        WHERE b.id IS NULL OR NOT b.is_search_index) AS invalid FROM page`,
    [state.after_id, Math.min(pageSize, 25)]
  )
  if (page.invalid)
    throw new SearchRetirementError(
      'A captured cleanup target is no longer Search-marked; no page was committed'
    )
  if (page.after_id !== null) {
    await tx.unsafe(
      `UPDATE ${STATE} SET after_id = $1, round_mutations = round_mutations + $2,
      ${documents ? 'retired_documents' : 'purged_embeddings'} = ${documents ? 'retired_documents' : 'purged_embeddings'} + $2 WHERE id = 1`,
      [page.after_id, page.changed]
    )
    return
  }
  if (Number(state.round_mutations) > 0) {
    await transition(tx, state.phase)
    return
  }
  await transition(tx, documents ? 'finalize' : 'documents')
}

/** Commits at most one bounded page. A timeout rolls back both its writes and cursor. */
export async function advanceSearchRetirement(
  sql: Sql,
  options: { pageSize: number }
): Promise<SearchRetirementStatus> {
  if (!Number.isInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > 100) {
    throw new SearchRetirementError('Page size must be an integer from 1 to 100')
  }
  return operation(sql, async (tx) => {
    const state = await stateOf(tx)
    requireValid(state)
    await verifyRelationIdentity(tx, state)
    const size = options.pageSize
    const before = await statusOf(tx)
    if (
      before.changeBacklogAtLimit &&
      !['ready', 'catchup', 'cutover', 'purge', 'documents', 'finalize', 'done'].includes(
        state.phase
      )
    ) {
      const reconciled = await reconcilePage(tx, size)
      await tx`UPDATE public.search_retirement_state SET reconciled = reconciled + ${reconciled} WHERE id = 1`
      return statusOf(tx)
    }
    if (state.phase === 'snapshot') {
      const [page] = await tx<PageResult[]>`WITH page AS MATERIALIZED (
        SELECT id, is_search_index FROM public.knowledge_base WHERE id > ${state.after_id} ORDER BY id LIMIT ${size}
      ), inserted AS (INSERT INTO public.search_retirement_targets (knowledge_base_id)
        SELECT id FROM page WHERE is_search_index ON CONFLICT DO NOTHING RETURNING 1)
      SELECT max(id) AS after_id, count(*)::int AS scanned, (SELECT count(*)::int FROM inserted) AS changed FROM page`
      if (page.after_id === null) await transition(tx, 'copy')
      else
        await tx`UPDATE public.search_retirement_state SET after_id = ${page.after_id} WHERE id = 1`
    } else if (state.phase === 'copy') {
      const page = await copyPage(tx, state, size)
      if (page.after_id === null) await transition(tx, 'catchup')
      else
        await tx`UPDATE public.search_retirement_state SET after_id = ${page.after_id},
        source_scanned = source_scanned + ${page.scanned}, copied = copied + ${page.changed} WHERE id = 1`
    } else if (state.phase === 'catchup' || state.phase === 'ready') {
      const reconciled = await reconcilePage(tx, size)
      if (reconciled > 0) {
        await tx`UPDATE public.search_retirement_state SET reconciled = reconciled + ${reconciled}, ready_at = NULL WHERE id = 1`
        if (state.phase === 'ready') await transition(tx, 'catchup')
      }
      if (reconciled === 0) {
        if (state.resume_phase === 'ready' && !state.ready_at) {
          await tx.unsafe(`ANALYZE ${SHADOW} (id, knowledge_base_id, document_id, enabled)`)
          await tx`UPDATE public.search_retirement_state SET ready_at = clock_timestamp() WHERE id = 1`
        }
        if (state.phase === 'catchup') await transition(tx, state.resume_phase)
      }
    } else if (state.phase === 'validate-source' || state.phase === 'validate-shadow') {
      const page = await validatePage(tx, state, size)
      if (page.after_id === null) {
        if (state.phase === 'validate-source') await transition(tx, 'validate-shadow')
        else {
          await tx`UPDATE public.search_retirement_state SET resume_phase = 'ready' WHERE id = 1`
          await transition(tx, 'catchup')
        }
      } else {
        const counter = state.phase === 'validate-source' ? 'validated_source' : 'validated_shadow'
        await tx.unsafe(
          `UPDATE ${STATE} SET after_id = $1, ${counter} = ${counter} + $2 WHERE id = 1`,
          [page.after_id, page.scanned]
        )
      }
    } else if (state.phase === 'purge' || state.phase === 'documents') {
      await purgePage(tx, state, size)
    }
    return statusOf(tx)
  })
}

async function replaceVectorWriter(tx: TransactionSql): Promise<void> {
  await tx.unsafe(`CREATE OR REPLACE FUNCTION public.sync_embedding_search() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM public.knowledge_base WHERE id = NEW.knowledge_base_id AND NOT is_search_index) THEN
        DELETE FROM public.embedding_search WHERE id = NEW.id;
        RETURN NEW;
      END IF;
      INSERT INTO public.embedding_search AS s (${columns})
      SELECT ${projectedValues('NEW', 'k.embedding_model')} FROM public.knowledge_base k WHERE k.id = NEW.knowledge_base_id
      ON CONFLICT (id) DO UPDATE SET ${assignments};
      RETURN NEW;
    END $$`)
}

/** Ordinary writes no longer need capture once the replacement receives synchronous projections. */
async function retainSearchCapture(tx: TransactionSql): Promise<void> {
  await tx.unsafe(`CREATE OR REPLACE FUNCTION public.capture_search_retirement_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    BEGIN
      IF TG_OP <> 'DELETE' AND EXISTS (SELECT 1 FROM public.search_retirement_targets
        WHERE knowledge_base_id = NEW.knowledge_base_id) THEN
        INSERT INTO public.search_retirement_changes (embedding_id) VALUES (NEW.id)
        ON CONFLICT (embedding_id) DO UPDATE SET generation = search_retirement_changes.generation + 1;
      END IF;
      RETURN NULL;
    END $$`)
  await tx.unsafe(`CREATE OR REPLACE FUNCTION public.invalidate_search_retirement() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    BEGIN
      IF OLD.is_search_index IS DISTINCT FROM NEW.is_search_index
        AND EXISTS (SELECT 1 FROM public.search_retirement_targets WHERE knowledge_base_id = NEW.id) THEN
        UPDATE public.search_retirement_state SET invalidated = true,
          invalidation_reason = 'captured-target-marker-changed' WHERE id = 1;
      END IF;
      RETURN NULL;
    END $$`)
}

/** A zero-backlog metadata swap; busy relations cause an immediate rollback, never a wait queue. */
export async function cutoverSearchRetirement(sql: Sql): Promise<SearchRetirementStatus> {
  return operation(sql, async (tx) => {
    const state = await stateOf(tx)
    requireValid(state)
    await verifyRelationIdentity(tx, state)
    if (state.phase !== 'ready')
      throw new SearchRetirementError(
        'Replacement must complete copy, catchup, and validation before cutover'
      )
    await tx.unsafe(
      'LOCK TABLE public.knowledge_base, public.embedding IN SHARE ROW EXCLUSIVE MODE NOWAIT'
    )
    await tx.unsafe(`LOCK TABLE public.embedding_search, ${SHADOW} IN ACCESS EXCLUSIVE MODE NOWAIT`)
    requireValid(await stateOf(tx))
    await inspectProjection(tx)
    if ((await statusOf(tx)).pendingChanges)
      throw new SearchRetirementError(
        'Concurrent changes remain; run another bounded catchup page before cutover'
      )
    const [snapshots] = await tx<{ observable: boolean; stale: boolean; prepared: boolean }[]>`
      SELECT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
          OR pg_has_role(current_user, 'pg_read_all_stats', 'USAGE') AS observable,
        EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.datid = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND a.pid <> pg_backend_pid() AND a.xact_start <= (SELECT ready_at FROM public.search_retirement_state WHERE id = 1)) AS stale,
        (SELECT ready_at IS NOT NULL FROM public.search_retirement_state WHERE id = 1) AS prepared`
    if (!snapshots.observable)
      throw new SearchRetirementError(
        'Cutover requires pg_read_all_stats to verify the transaction snapshot barrier'
      )
    if (!snapshots.prepared || snapshots.stale)
      throw new SearchRetirementError(
        'Transactions predate the replacement readiness barrier; let them finish and retry cutover'
      )
    const [indexes] = await tx<{ valid: boolean }[]>`
      SELECT coalesce(bool_and(i.indisvalid AND i.indisready), false)
          AND jsonb_object_agg(c.relname, pg_get_indexdef(i.indexrelid)) =
            (SELECT index_manifest FROM public.search_retirement_state WHERE id = 1) AS valid
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE i.indrelid = 'public.embedding_search_retirement_shadow'::regclass`
    if (!indexes.valid)
      throw new SearchRetirementError('Replacement index definitions changed after preparation')
    const [shape] = await tx.unsafe<{ same: boolean }[]>(`SELECT (${REPLACEMENT_SHAPE}) =
      (SELECT relation_manifest FROM ${STATE} WHERE id = 1) AS same`)
    if (!shape.same) {
      throw new SearchRetirementError(
        'Replacement columns, constraints, or dependencies changed after preparation'
      )
    }
    const [privileges] = await tx<{ same: boolean }[]>`
      WITH source AS (SELECT a.grantee, a.privilege_type, a.is_grantable
        FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        WHERE c.oid = 'public.embedding_search'::regclass),
      replacement AS (SELECT a.grantee, a.privilege_type, a.is_grantable
        FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        WHERE c.oid = 'public.embedding_search_retirement_shadow'::regclass)
      SELECT a.relowner = b.relowner AND NOT EXISTS (SELECT * FROM source EXCEPT SELECT * FROM replacement)
        AND NOT EXISTS (SELECT * FROM replacement EXCEPT SELECT * FROM source) AS same
      FROM pg_class a, pg_class b WHERE a.oid = 'public.embedding_search'::regclass
        AND b.oid = 'public.embedding_search_retirement_shadow'::regclass`
    if (!privileges.same)
      throw new SearchRetirementError(
        'Projection privileges changed; replacement cutover is not safe'
      )
    const [aclTrigger] = await tx<{ present: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.embedding_search'::regclass
        AND tgname = 'embedding_search_source_acl_set' AND NOT tgisinternal) AS present`
    for (const index of SHARED_INDEXES) {
      const [installed] = await tx<{ present: boolean; valid: boolean; original: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass(${`public.${index.name}`})) AS present,
          EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass(${`public.${index.name}`})
            AND indrelid = 'public.embedding_search'::regclass) AS original,
          EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass(${`public.embedding_search_retirement_shadow_${index.suffix}`})
            AND indrelid = 'public.embedding_search_retirement_shadow'::regclass AND indisvalid AND indisready) AS valid`
      if (!installed.valid)
        throw new SearchRetirementError(
          'Replacement index is missing or invalid; cutover is not permitted'
        )
      if (installed.present && !installed.original)
        throw new SearchRetirementError('A shared index name belongs to an unrelated relation')
      if (installed.present)
        await tx.unsafe(
          `ALTER INDEX public.${identifier(index.name)} RENAME TO ${identifier(`embedding_search_retirement_backup_${index.suffix}`)}`
        )
      await tx.unsafe(
        `ALTER INDEX public.${identifier(`embedding_search_retirement_shadow_${index.suffix}`)} RENAME TO ${identifier(index.name)}`
      )
    }
    await tx.unsafe(
      `ALTER TABLE public.embedding_search RENAME TO embedding_search_retirement_backup`
    )
    await tx.unsafe(`ALTER TABLE ${SHADOW} RENAME TO embedding_search`)
    await tx.unsafe(`ALTER TABLE public.embedding_search
      RENAME CONSTRAINT embedding_search_retirement_shadow_embedding_fk TO embedding_search_id_embedding_id_fk`)
    if (aclTrigger.present) {
      await tx.unsafe(`CREATE TRIGGER embedding_search_source_acl_set
        BEFORE INSERT OR UPDATE OF document_id, enabled ON public.embedding_search
        FOR EACH ROW WHEN (current_setting('sim.projection_mode', true) IS DISTINCT FROM 'async')
        EXECUTE FUNCTION public.set_projection_source_acl()`)
    }
    await replaceVectorWriter(tx)
    await retainSearchCapture(tx)
    await transition(tx, 'cutover')
    return statusOf(tx)
  })
}

/** Explicitly ends the backup observation window before any canonical deletion can touch its HNSW graphs. */
export async function beginSearchRetirementPurge(sql: Sql): Promise<SearchRetirementStatus> {
  return operation(sql, async (tx) => {
    const state = await stateOf(tx)
    requireValid(state)
    await verifyRelationIdentity(tx, state)
    if (state.phase !== 'cutover')
      throw new SearchRetirementError(
        'Purge requires a completed cutover and an explicit end to backup retention'
      )
    await tx.unsafe('LOCK TABLE public.embedding IN SHARE ROW EXCLUSIVE MODE NOWAIT')
    await tx.unsafe(`LOCK TABLE ${BACKUP} IN ACCESS EXCLUSIVE MODE NOWAIT`)
    // Removing the backup FK can upgrade its parent lock; keep that wait below a normal page's limit.
    await tx.unsafe("SET LOCAL lock_timeout = '1ms'")
    await tx.unsafe(`DROP TABLE ${BACKUP} RESTRICT`)
    await transition(tx, 'purge')
    return statusOf(tx)
  })
}

/** Explicitly removes capture after operators clear the final primary and replica DDL window. */
export async function finalizeSearchRetirement(sql: Sql): Promise<SearchRetirementStatus> {
  return operation(sql, async (tx) => {
    const state = await stateOf(tx)
    requireValid(state)
    await verifyRelationIdentity(tx, state)
    if (state.phase !== 'finalize') {
      throw new SearchRetirementError(
        'Finalization requires completed canonical and document retirement'
      )
    }
    await tx.unsafe(
      'LOCK TABLE public.knowledge_base, public.embedding IN SHARE ROW EXCLUSIVE MODE NOWAIT'
    )
    requireValid(await stateOf(tx))
    if ((await statusOf(tx)).pendingChanges) {
      await transition(tx, 'purge')
      return statusOf(tx)
    }
    await removeCapture(tx)
    await transition(tx, 'done')
    return statusOf(tx)
  })
}

/** Before cutover, abort removes only this job's empty-or-partial replacement and capture machinery. */
export async function abortSearchRetirement(sql: Sql): Promise<void> {
  return operation(sql, async (tx) => {
    if (!(await relationExists(tx, STATE))) return
    const state = await stateOf(tx)
    await verifyRelationIdentity(tx, state)
    if (['cutover', 'purge', 'documents', 'finalize', 'done'].includes(state.phase)) {
      throw new SearchRetirementError(
        'A cut-over replacement cannot be rolled back by renaming a stale backup'
      )
    }
    await tx.unsafe(
      'LOCK TABLE public.knowledge_base, public.embedding IN SHARE ROW EXCLUSIVE MODE NOWAIT'
    )
    await tx.unsafe(`LOCK TABLE ${SHADOW} IN ACCESS EXCLUSIVE MODE NOWAIT`)
    await removeCapture(tx)
    if (await relationExists(tx, 'public.search_embedding_cleanup_progress')) {
      await tx.unsafe(
        'LOCK TABLE public.search_embedding_cleanup_progress IN SHARE ROW EXCLUSIVE MODE NOWAIT'
      )
      await tx.unsafe(
        'DROP TRIGGER IF EXISTS search_retirement_legacy_guard ON public.search_embedding_cleanup_progress'
      )
    }
    await tx.unsafe('DROP FUNCTION IF EXISTS public.guard_legacy_search_retirement()')
    await tx.unsafe(
      `DROP TABLE ${SHADOW}, public.search_retirement_changes, public.search_retirement_targets, ${STATE} RESTRICT`
    )
  })
}
