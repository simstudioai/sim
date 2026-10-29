import type { db } from '@sim/db'

/** One node of an `EXPLAIN (FORMAT JSON)` plan, with the fields plan assertions read. */
export interface PlanNode {
  'Node Type': string
  'Index Name'?: string
  /** The scan's index search condition, as PostgreSQL prints it. */
  'Index Cond'?: string
  Plans?: PlanNode[]
}

export interface ExplainCapturedOptions {
  /** Picks the captured statement to explain; the first one `run` sends by default. */
  match?: RegExp
  /** Planner settings applied with `SET LOCAL` for the EXPLAIN only, e.g. `{ enable_sort: 'off' }`. */
  gucs?: Record<string, string>
}

function flatten(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(flatten)]
}

/**
 * The plan PostgreSQL gives a statement that `run` sends through `database`, with the parameters
 * it bound, as a flat list of plan nodes. Application code builds its SQL internally, so this
 * records what reaches the driver while `run` executes, then EXPLAINs that exact statement in its
 * own transaction, where `gucs` apply without leaking into the pool.
 */
export async function explainCaptured(
  database: typeof db,
  run: () => Promise<unknown>,
  options: ExplainCapturedOptions = {}
): Promise<PlanNode[]> {
  const client = database.$client
  const send = client.unsafe
  const sent: { query: string; params: Parameters<typeof send>[1] }[] = []
  client.unsafe = ((query, params, queryOptions) => {
    sent.push({ query, params })
    return send.call(client, query, params, queryOptions)
  }) as typeof send
  try {
    await run()
  } finally {
    client.unsafe = send
  }

  const statement = options.match ? sent.find(({ query }) => options.match?.test(query)) : sent[0]
  if (!statement) throw new Error('The call sent no statement to explain')

  const [row] = await client.begin(async (tx) => {
    for (const [name, value] of Object.entries(options.gucs ?? {})) {
      await tx.unsafe('SELECT set_config($1, $2, true)', [name, value])
    }
    return tx.unsafe(`EXPLAIN (FORMAT JSON) ${statement.query}`, statement.params)
  })
  const [{ Plan }] = row['QUERY PLAN'] as [{ Plan: PlanNode }]
  return flatten(Plan)
}
