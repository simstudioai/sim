# Blocks Scope

These rules apply to block definitions under `apps/sim/blocks/**`.

- Keep block `type` values and tool mappings aligned with the actual integration tool IDs.
- Every subblock `id` must be unique within the block, even across different conditions.
- Use `condition`, `required`, `dependsOn`, and `mode` deliberately to reflect the UX and execution requirements.
- Use `canonicalParamId` only to link alternative inputs for the same logical parameter; do not reuse it as a subblock `id`.
- If one field in a canonical group is required, all alternatives in that group must also be required.
- Put type coercion in `tools.config.params`, never in `tools.config.tool`.
- When supporting file inputs, follow the basic/advanced pattern and normalize with `normalizeFileInput`.
- Keep block outputs aligned with what the referenced tools actually return.
- `{Service}BlockMeta.skills` (curated, one-click-add agent skills shown on the integration detail page) must be grounded in operations the block exposes via `tools.access` and derived from real, popular use cases found online — web-search and source each one; never invent or hallucinate skills.

## Canvas sentences

A block's card can replace its label/value rows with one line of prose:

```
Slack                                    ← header (already names the block)
Post ⟨Ship it 🚀⟩ to ⟨#eng⟩              ← the sentence; ⟨…⟩ are live value chips
```

Declare it under `canvasPresentation.sentences` — `default` for a block with no
operation dropdown, `byOperation` keyed by the dropdown's **option ids** otherwise.
A block that declares nothing keeps the row layout, so adoption is incremental.

Validate with `bun run apps/sim/scripts/check-canvas-sentences.ts --block=<type>`.
Everything below that is mechanically checkable is enforced there — a sentence
that breaks a rule fails **silently** at runtime (no throw, no log, just a card
that stops reading like the rest of the canvas), which is why the check exists.

### `core`: what an untouched card says

Every clause is optional by default and renders only once its field is filled.
`core: true` is the one exception: that clause **always** renders, showing the
value when set and the field's **noun** when not.

```
Post ⟨Ship it 🚀⟩ to ⟨#eng⟩        ← configured
Post ⟨a message⟩                   ← untouched, from `core` alone
```

The noun is derived from the subblock's `title` (`resolveFieldNoun`), so it costs
nothing to author — and **it carries its own article**, which is why you never put
`a`/`an`/`the` in front of a core chip. Where a title cannot be read mid-sentence
("Message ID to Reply To"), set `canvasNoun` on the subblock rather than working
around it in the copy.

Two rules follow, both enforced:

- **The core clauses alone must read as a complete sentence** — they are the whole
  of what a fresh card says. Every sentence needs at least one core clause or some
  literal copy; the check runs the real resolver against an empty card and fails
  if nothing comes back.
- **A core clause's field must be provably on the card for that operation.** There
  is no replacement copy in this DSL, so a clause gated away silently drops and
  the promise `core` makes was false. Anchor on a field the operation always
  shows, or drop `core` and let literal copy carry the sentence.

Do not mark every clause `core` — a configured card would become a wall of
placeholders. Mark what the sentence is *about*; leave the details optional.

#### `mode: 'advanced'` fields can never be core

A card opens in **basic** mode, so a standalone `mode: 'advanced'` field is not on
it. `core` on one is a promise the card cannot keep: the clause drops and, since a
fresh card has no filled rows either, the block paints a bare header. This is the
single most common way to get it wrong — 35 sentences shipped it — and it is now
caught by `check:canvas-sentences`.

It bites hardest on **list operations**, whose only fields are usually advanced
pagination controls. Those want literal copy, not an anchor:

```ts
// ✗ `limit` is mode:'advanced' — a fresh card renders nothing at all
list_customers: [{ text: 'List customers, up to', field: 'limit', core: true }]

// ✓ the literal always renders; the detail appears once it is filled
list_customers: ['List customers', { text: ', up to', field: 'limit' }]
```

A canonical basic/advanced **pair** is fine to anchor on — one member is always
showing — provided the clause names every member (`field: ['tableSelector',
'manualTableId']`), which is separately enforced.

#### An operation whose empty state means "act on all"

Some operations act on one record with an id and on *everything* without one —
their subblock usually says so ("Leave empty to list all contacts"). Marking the
id `core` makes an untouched card assert a single target it will not act on. Write
literal copy that is true both ways:

```ts
// ✗ claims one contact; untouched, this returns every contact
get_contacts: [{ text: 'Read contact', field: 'contactId', core: true }]

// ✓ true empty and true filled
get_contacts: ['Read contacts', { text: 'matching', field: 'contactId' }]
```

#### Give the operation dropdown a default

A block whose `operation` dropdown has no `value: () => '<id>'` stores `null` on
creation, so no `byOperation` entry matches and the card paints nothing until the
user opens the panel. Seed it with the operation a user most likely wants — a read,
not a mutation. Use `value:`, not `defaultValue:` — the panel's dropdown only
reads `value`, so the two would disagree.

### Trigger cards

A card in trigger mode paints its own sentence, from `canvasPresentation.triggerSentences`:

```ts
triggerSentences?: {
  default?: CanvasSentence
  byTrigger?: Record<string, CanvasSentence>   // keyed by trigger id
}
```

**Most blocks declare nothing.** Trigger mode usually exposes a webhook URL and a
signing secret — plumbing, not meaning — and the thing worth reading is *which*
event was picked. That is already curated as the trigger's `name` in
`apps/sim/triggers/`, so the card derives `Run on Pull Request Opened` with no
authoring at all. Declare `triggerSentences` only when the configuration is
itself the meaning, as Schedule's frequency is.

What the sentence *says* shifts with the mode, though the voice does not. An
action sentence names what the block does; a trigger sentence names what starts
the run — `Run on an email arriving in ⟨INBOX⟩`, never `Read an email`. It is a
separate slot rather than another `byOperation` key because trigger mode swaps
the subblock set wholesale, and the operation dropdown still holds its
action-mode default.

Sim's own entry points (`start_trigger`, `manual_trigger`, `chat_trigger`,
`api_trigger`, `input_trigger`, `starter`) are exempt: they *are* the start of
the run and their header already says so, so a sentence would only repeat it.

### Voice

- **Imperative, the card naming its own action.** `Post a message to ⟨#eng⟩`. Never
  `Posts a message` (third person), never `Post a Slack message` — the header
  already says Slack, so naming it again wastes the line. The heading above the
  sentence is the operation title (`Send Email`), and the two share a voice.
  `check:canvas-sentences` enforces this on action *and* trigger cards.
- **The sentence carries the verb.** It replaces the chips row, which is what
  shows the operation today. `List channels`, not `Channels`.
- **Lead with the verb, put the value last** where possible — the chip is the part
  a user scans for.
- **One clause per fact, most important first.** The card is 250px wide and
  wraps at ~2 lines; later clauses are the ones that fall off.
- **At most three value chips**, and two reads best — every chip adds width and
  pushes the card taller. An operation with no field worth showing is just a
  literal: `['List all channels']` is a complete, valid sentence.
- Sentence case, no trailing period, no articles you can drop (`Read schema of`
  beats `Read the schema of the table`).

### Structure

- **Mark the clauses the sentence is *about* `core`**, and leave the rest optional.
  A sentence may have as many core clauses as it needs to read whole — they hold
  only their own slot, so there is no one-anchor limit.
- **Use literal copy when every field is an optional filter.** A list/search
  operation whose filters are all optional has nothing worth a placeholder. Lead
  with a literal and let every clause be optional:
  `['List issues', { text: ', assigned to', field: 'assignee' }]`.
- **Each optional clause owns its leading connective.** Write
  `{ text: ', where', field: 'filter' }`, never
  `{ ..., after: ', where' }, { field: 'filter' }` — a dropped clause takes its own
  `text` with it, but an `after` on the *previous* clause survives and dangles.
- **Bare strings are always-on literal copy.** Prefer folding them into a clause's
  `text` so they can drop with the value.
- **A chip is a noun, never the verb.** A chip renders a dropdown's *label*, so
  when those labels are themselves verbs (`Archive` / `Unarchive`) you cannot
  build the sentence around one — `Apply ⟨Archive⟩ to thread ⟨id⟩` is the
  result. State the change instead: `Set thread ⟨id⟩ to ⟨Archive⟩`.

### The four mistakes that break cards silently

1. **Naming one member of a canonical pair.** A `canonicalParamId` group has a
   basic picker and an advanced raw-id input; an advanced-mode user has only the
   second filled. List every member:
   `field: ['tableSelector', 'manualTableId']`. Three naming conventions are in
   use (`xSelector`/`x`, `xSelector`/`manualX`, `uploadX`/`xRef`), so take the
   membership from the spec's `canonicalGroups` — you cannot derive it from the
   canonical id.

   A `field` array is also the right tool for **mutually exclusive alternates
   that are not a canonical pair** — Slack's destination is a channel *or* a DM
   id, Sendblue's is a number list *or* a group id. First available wins.
2. **Referencing a field the operation never shows.** A subblock gated
   `condition: { field: 'operation', value: [...] }` can only appear in the
   `byOperation` entries it lists.
3. **Two operations that render the same prose.** On a block with dozens of
   similar read endpoints it is easy to paste a clause and never adjust it, so
   `get_thread` and `get_thread_replies` both say `Read thread ⟨id⟩` and the
   card cannot tell the user which one runs. Name what each actually returns.

   The check runs on **both** readings, so two operations may not collide once
   their optional clauses are empty either — which is how an untouched card
   reads. `Add tag ⟨id⟩ to contact ⟨x⟩` and `… to conversation ⟨y⟩` both bare
   to `Add tag ⟨id⟩`; marking the target clause `core` is what tells them apart.
4. **An optional clause carrying the action's target or scope.** This one the
   validator cannot catch — 895 clauses fleet-wide fit the shape and only ~45
   are defects, so the discriminator is semantic. Ask what the sentence means
   with that clause gone. `Remove user ⟨id⟩` reads as deleting the user, not
   removing them from a group; `Delete records from ⟨index⟩` reads as clearing
   the whole index. If the truncated reading names a broader or different
   action, mark that clause `core` so it holds its place. `Delete thread ⟨id⟩`
   losing an optional `, in ⟨channel⟩` is fine — it still means the same thing.

### Two rules the validator enforces on your copy

- **No article in front of a chip.** For a `core` chip the noun already supplies
  one, so `Create a ⟨campaignType⟩` reads `Create a a campaign type` — drop the
  article and let the noun carry it. For an optional chip the article has to agree
  with a dropdown *label* whose initial sound you cannot know
  (`Create a ⟨A/B Split⟩ campaign`), so move the value out from behind it:
  `Create a campaign of type ⟨type⟩`.
- **Both halves of a correlative, or neither.** A clause opening `from …` or
  `between …` needs the clause carrying `to …`/`and …` to survive an empty card,
  or `Route from ⟨an origin⟩` describes a different journey. Mark both halves
  `core`.

### Versioned blocks

28 files export a `_v2` (or `_v3`…) variant that spreads the base — `export const
GmailV2Block = { ...GmailBlock, type: 'gmail_v2', ... }`. The spread carries
`canvasPresentation` with it, which is right only when the variant has the *same*
operation dropdown.

**When the operation sets differ, inheritance is a bug.** `file.ts` chains
`FileV5 → FileV4 → FileV3`, and an inherited `byOperation` carries keys like
`file_parser_v3` that later dropdowns do not have — the validator reports
`no option with id`. Give every export whose dropdown differs its own
`canvasPresentation`.

Always run `--block=<type>` for *every* registry type the file exports, not just
the base. That is what tells you which case you are in.

### Worked example

```ts
canvasPresentation: {
  defaultTitle: 'Table',
  sentences: {
    byOperation: {
      query_rows: [
        { text: 'Query rows from', field: ['tableSelector', 'manualTableId'], core: true },
        { text: ', where', field: ['filterBuilder', 'filter'] },
        { text: ', up to', field: 'limit', after: 'rows' },
      ],
      get_schema: [
        { text: 'Read the schema of', field: ['tableSelector', 'manualTableId'], core: true },
      ],
    },
  },
}
```

Renders as `Query rows from ⟨orders⟩, where ⟨status = open⟩, up to ⟨100⟩ rows`,
shortens to `Query rows from ⟨orders⟩` when only the table is set, and reads
`Query rows from ⟨a table⟩` on an untouched card.

### Other things that bite

- **`defaultTitle` is required** by the `canvasPresentation` type, so declaring
  sentences also decides the card's header for auto-named instances. Use the
  block's name minus any "(Legacy)" suffix. Do not add `typeLabel` or
  `operationSubBlockId` as part of a sentence change — those alter title
  resolution for workflows that already exist.
- **Trigger mode has no sentence.** A dual-mode block's card keeps its rows when
  used as a trigger, so write only for the action side.

### Context to write from

Start with the spec tool — it resolves everything a sentence depends on, so you
do not have to reconstruct it from a 500–3600 line block file:

```bash
bun run apps/sim/scripts/canvas-sentence-spec.ts --block=slack --pretty
```

It reports, per operation, the label, what the underlying tool `does`, and
`fields` — **the only subblock ids that operation can show**, already resolved
through every `condition`. Plus `canonicalGroups` with every pair fully
enumerated. Naming a field outside an operation's `fields` list is the dead-clause
bug; listing one member of a canonical group is the advanced-mode bug. The spec
makes both mechanical.

When `hasCatalogEntry` is `false` the block is `category: 'blocks'` and has no
row in `integrations.json` — read `apps/sim/tools/{name}/*.ts` for each
operation's description instead. The `enrichment` block is the one exception:
its per-operation prose lives on the `EnrichmentConfig` `description` under
`apps/sim/enrichments/{id}/{id}.ts`.

The spec already omits credentials, passwords, and the operation selector, so
anything it lists is fair game for a chip. Dropdowns that carry a default are
still a judgement call — `level` defaulting to `All` spends a chip to say
nothing.

For intent a tool description does not settle, `apps/docs/content/docs/integrations/{service}.mdx`
carries hand-written `MANUAL-CONTENT-START:intro` prose.
