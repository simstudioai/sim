import { copilotMessages } from '@sim/db/schema'
import { isRecordLike } from '@sim/utils/object'
import { type SQL, sql } from 'drizzle-orm'

/**
 * Each `copilot_messages` row's `content`, detoasted once, as `detoasted.content` for a
 * `crossJoinLateral`. Postgres detoasts a toasted column again for every expression that
 * reads it, so a projection reading several fields of a multi-MB message reads this copy.
 */
export const detoastedMessageContent: SQL = sql`(select ${copilotMessages.content} #> '{}' as content offset 0) as detoasted`

/**
 * Each message's `content` reduced to `fields` plus its text `contentBlocks`, so a reader that
 * needs only a transcript's text never loads its tool payloads (multi-MB `toolCall.params`). A
 * field the message lacks, and a `contentBlocks` that is not an array, read as JSON null; a
 * content that is not an object passes through unchanged. Requires
 * {@link detoastedMessageContent} joined.
 */
export function textMessageContent(fields: readonly string[]): SQL {
  const content = sql`detoasted.content`
  // The strict path copies only the blocks it keeps, never the tool payloads it skips; `silent`
  // skips a malformed block instead of failing the read.
  const textBlocks = sql`case when jsonb_typeof(${content} -> 'contentBlocks') = 'array'
    then jsonb_path_query_array(${content}, 'strict $.contentBlocks[*] ? (@.type == "text")', '{}', true) end`
  const entries = [
    ...fields.map((field) => sql`${field}::text, ${content} -> ${field}::text`),
    sql`'contentBlocks', ${textBlocks}`,
  ]
  return sql`case when jsonb_typeof(${content}) = 'object'
    then jsonb_build_object(${sql.join(entries, sql`, `)})
    else ${content} end`
}

/**
 * The transcript a `past_chat` context quotes: one `role: text` line per message, its text
 * blocks preferred over its plain `content`. Reads only what {@link textMessageContent} keeps.
 */
export function quoteChatTranscript(messages: unknown[]): string {
  return messages
    .map((message) => {
      const m = message as { role?: unknown; content?: unknown; contentBlocks?: unknown }
      const role = m.role || 'user'
      let text = ''
      if (Array.isArray(m.contentBlocks)) {
        text = m.contentBlocks
          .filter((block) => isRecordLike(block) && block.type === 'text')
          .map((block) => String(block.content || ''))
          .join('')
          .trim()
      }
      if (!text && typeof m.content === 'string') text = m.content
      return `${role}: ${text}`.trim()
    })
    .filter((line) => line.length > 0)
    .join('\n')
}
