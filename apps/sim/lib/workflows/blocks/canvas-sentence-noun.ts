import type { SubBlockConfig } from '@/blocks/types'

/**
 * The noun a card shows in place of a value the user has not filled in yet.
 *
 * A core clause renders whether or not its field holds a value, so the chip
 * needs something to say when it is empty: `Send a message to ⟨a channel⟩`.
 * Deriving that from the subblock's own `title` — rather than having each
 * sentence carry replacement copy — is what keeps the two readings of a card
 * from drifting apart. There is only ever one sentence; the chip is what
 * changes.
 */

/** Tokens that stay upper-case when a title is lowered into running prose. */
const INITIALISMS = new Set([
  'ID',
  'URL',
  'URI',
  'API',
  'SQL',
  'JSON',
  'HTML',
  'CSV',
  'PDF',
  'IP',
  'DNS',
  'SMS',
  'UUID',
  'ARN',
  'CRM',
  'SKU',
  'UTC',
  'DM',
  'PR',
  'KB',
  'AI',
  'S3',
])

/** Vowel-letter words pronounced consonant-initial, so they take "a". */
const CONSONANT_SOUND = /^(one|once|eu|url|uri|ui|uuid|us|utc)\b|^u[bcdfgklmnprstvz][aeiouy]/i

/** Consonant-letter words pronounced vowel-initial, so they take "an". */
const VOWEL_SOUND = /^(hour|honest|hono[u]?r|heir)\b/i

/**
 * Whether a word opens on a letter *name* rather than a letter sound.
 *
 * `SMS` reads "ess-em-ess", so it takes "an". All-caps words read as words do
 * not — `MERGE` and `HEAD` are HTTP verbs — and an interior vowel is the cheap
 * tell. Erring toward "not an initialism" only costs a missed flag, while the
 * reverse would have the fleet writing `an MERGE request`.
 */
function isVowelSoundInitialism(word: string): boolean {
  const token = word.split(/[^A-Za-z0-9]/)[0] ?? ''
  if (!/^[FHLMNRSX][A-Z0-9]*$/.test(token)) return false
  return !/[AEIOU]/.test(token.slice(1))
}

/** Whether a word reads vowel-initial, for `a` vs `an` agreement. */
export function startsWithVowelSound(text: string): boolean {
  const word = text.trim().replace(/^[^\p{L}\p{N}]+/u, '')
  if (!word) return false
  if (CONSONANT_SOUND.test(word)) return false
  if (VOWEL_SOUND.test(word)) return true
  if (isVowelSoundInitialism(word)) return true
  return /^[aeiou]/i.test(word)
}

/** The indefinite article a phrase takes, by how its first word is pronounced. */
export function articleFor(phrase: string): 'a' | 'an' {
  return startsWithVowelSound(phrase) ? 'an' : 'a'
}

/**
 * Singular words that happen to end in `s`.
 *
 * A plural noun takes no article (`Add ⟨labels⟩`), so the whole article
 * decision hangs on this, and a false positive reads as `Set ⟨radius⟩` with its
 * "a" missing. `-us`/`-is` covers the productive Latin cases (radius, status,
 * focus, analysis, basis) without listing each; the rest are named.
 *
 * The lower-case letter before `-us`/`-is` is load-bearing: without it `URIs`
 * and `APIs` match as Latin singulars and the card reads `a track URIs`.
 */
const SINGULAR_ENDING_IN_S = /([a-z](us|is)|ss|alias|canvas|atlas|lens|bus|gas|https?)$/i

/** A pluralised initialism — `URIs`, `IDs`, `SKUs` — which is plural. */
const PLURAL_INITIALISM = /^[A-Z0-9]{2,}s$/

/**
 * Mass nouns, which name a substance rather than a thing you can count and so
 * take no article on their own: `Run ⟨a code⟩` and `Append ⟨a content⟩` are not
 * English in the way `Read ⟨a key⟩` is.
 *
 * Matched against the whole noun, never the head of a compound — an `invite
 * code` and a `comment text` are countable things, and stripping their article
 * would trade one wrong reading for another.
 */
const UNCOUNTABLE = new Set(['audio', 'code', 'content', 'media', 'text'])

function isPlural(phrase: string): boolean {
  const last = phrase.trim().split(/\s+/).pop() ?? ''
  if (!/s$/.test(last)) return false
  if (PLURAL_INITIALISM.test(last)) return true
  return !SINGULAR_ENDING_IN_S.test(last)
}

/**
 * Form-label scaffolding that does not survive being read mid-sentence.
 *
 * A title carries hints for someone filling the field in — "Radius (meters)",
 * "Attendees (comma-separated emails)", "Table Name (optional)". Inside a
 * sentence the card is describing what the block does, not instructing, so the
 * parenthetical goes and `a radius` is what is left.
 */
const PARENTHETICAL = /\s*\([^)]*\)?/g

/**
 * The imperative a picker's label opens with.
 *
 * "Select Channel" is an instruction to the person filling the form; the card is
 * describing what the block does, so it wants the bare noun. Without this, every
 * selector on the canvas reads "post to ⟨a select channel⟩".
 */
const PICKER_IMPERATIVE = /^(select|choose|pick|enter|add)\s+/i

/**
 * Splits a run-together title into words.
 *
 * Some blocks label a field with the API's own identifier — SAP's
 * `SalesOrderType` — which would otherwise lower into "a salesordertype". The
 * second boundary keeps an initialism whole, so `HTTPMethod` reads
 * "HTTP method" rather than being split letter by letter.
 *
 * Only spaceless titles qualify. A title that already has spaces was written for
 * a human to read, and splitting inside its words turns brand names into
 * nonsense — "LinkedIn Slug" becomes "linked in slug".
 */
function splitCamelCase(title: string): string {
  const trimmed = title.trim()
  if (/\s/.test(trimmed)) return title
  /* `APIs` and `SKUs` are one word, not `AP Is` — the trailing plural `s` is
     the only lower-case letter, so the initialism boundary rule misfires. */
  if (PLURAL_INITIALISM.test(trimmed)) return title
  return title.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
}

/** Lowers a title into running prose, preserving initialisms. */
function toRunningProse(title: string): string {
  const stripped = title.replace(PARENTHETICAL, '').trim().replace(PICKER_IMPERATIVE, '')

  return splitCamelCase(stripped)
    .trim()
    .split(/\s+/)
    .map((word) => {
      const bare = word.replace(/[^A-Za-z0-9]/g, '')
      /* An author who capitalised a whole word meant it — `MCP Server`, `SKU`.
         Trusting the title beats maintaining a list of every acronym in use. */
      if (/^[A-Z0-9]{2,}$/.test(bare)) return bare
      /* A pluralised initialism keeps its lower-case `s`: "IDs", never "IDS". */
      if (/^[A-Z0-9]{2,}s$/.test(bare)) return bare
      /* A capital inside the word marks a brand, not Title Case — `LinkedIn`,
         `GitHub`, `PagerDuty` all read wrong once lowered. */
      if (/^[A-Za-z]+$/.test(bare) && /[A-Z]/.test(bare.slice(1))) return word
      if (/^[A-Za-z]+s$/.test(bare) && INITIALISMS.has(bare.slice(0, -1).toUpperCase())) {
        return `${bare.slice(0, -1).toUpperCase()}s`
      }
      return INITIALISMS.has(bare.toUpperCase()) ? bare.toUpperCase() : word.toLowerCase()
    })
    .join(' ')
}

/**
 * The placeholder noun for a field, as it reads inside a sentence.
 *
 * `canvasNoun` is the override for the cases a title cannot express — a title
 * is a form label ("Message ID to Reply To"), and only some of them survive
 * being read aloud mid-sentence. Everything else derives, so a new block gets
 * working cards without authoring a second vocabulary.
 */
export function resolveFieldNoun(subBlock: Pick<SubBlockConfig, 'title' | 'canvasNoun'>): string {
  if (subBlock.canvasNoun) return subBlock.canvasNoun

  const prose = toRunningProse(String(subBlock.title ?? '')).trim()
  if (!prose) return 'a value'
  if (isPlural(prose)) return prose
  if (UNCOUNTABLE.has(prose.toLowerCase())) return prose
  return `${articleFor(prose)} ${prose}`
}
