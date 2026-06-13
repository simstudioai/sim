/**
 * Seeds synthetic copilot chats at arbitrary message counts by cycling the
 * messages of an existing source chat. Each copy gets a fresh message_id
 * (mirrored into content.id, which the client uses as the React key) and a
 * monotonically increasing seq/created_at so ordering is preserved.
 *
 * Usage:
 *   node scripts/perf/seed-chat-scale.mjs --source <chatId> [--sizes 32,258,516,1032]
 *
 * Prints one line per created chat: <size> <chatId>
 * Cleanup: delete from copilot_chats where title like 'PERF n=%';
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const SOURCE = arg('source')
const SIZES = arg('sizes', '32,258,516,1032').split(',').map(Number)
if (!SOURCE || SIZES.some(Number.isNaN)) {
  console.error('Usage: node scripts/perf/seed-chat-scale.mjs --source <chatId> [--sizes 32,258,516]')
  process.exit(1)
}

const env = readFileSync(resolve(ROOT, 'apps/sim/.env'), 'utf8')
const DB_URL = env.match(/^DATABASE_URL="?([^"\n]+)"?$/m)[1]

const psql = (sql) => execFileSync('psql', [DB_URL, '-At', '-c', sql], { encoding: 'utf8' }).trim()

for (const size of SIZES) {
  const sql = `
    with new_chat as (
      insert into copilot_chats (id, user_id, workflow_id, title, model, workspace_id, type, resources, created_at, updated_at)
      select gen_random_uuid(), user_id, null, 'PERF n=${size}', model, workspace_id, type, resources, now(), now()
      from copilot_chats where id = '${SOURCE}'
      returning id
    ),
    src as (
      select role, content, model, tokens_in, tokens_out,
             row_number() over (order by seq asc nulls last, created_at asc, id asc) as rn,
             count(*) over () as total
      from copilot_messages
      where chat_id = '${SOURCE}' and deleted_at is null
    ),
    expanded as (
      select s.*, g.copy_idx, (g.copy_idx * s.total + s.rn) as new_seq
      from src s
      cross join generate_series(0, ${size} / 1 / (select min(total) from src) + 1) as g(copy_idx)
    ),
    prepared as (
      select role, content, model, tokens_in, tokens_out, new_seq,
             gen_random_uuid()::text as new_mid
      from expanded
      where new_seq <= ${size}
    )
    insert into copilot_messages (id, chat_id, message_id, role, content, model, tokens_in, tokens_out, seq, created_at, updated_at)
    select gen_random_uuid(), (select id from new_chat), new_mid, role,
           jsonb_set(content, '{id}', to_jsonb(new_mid)),
           model, tokens_in, tokens_out, new_seq,
           now() - interval '1 day' + (new_seq * interval '1 second'),
           now() - interval '1 day' + (new_seq * interval '1 second')
    from prepared
    returning chat_id`
  const out = psql(sql).split('\n').filter(Boolean)
  const chatId = out[0]
  const count = psql(`select count(*) from copilot_messages where chat_id = '${chatId}'`)
  console.log(`${size} ${chatId} (inserted ${count} messages)`)
}
