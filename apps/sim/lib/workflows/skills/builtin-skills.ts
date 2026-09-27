/**
 * Built-in (template) skills that ship with every workspace.
 *
 * These are NOT stored in the `skill` database table. They are merged into the
 * skill list at read time (see `listSkills` / the `/api/skills` route) so they
 * show up everywhere real skills do — the Skills page, the mothership `/`
 * mention menu, and the agent block — and they resolve when tagged. They are
 * marked read-only so the UI hides edit/delete, and the upsert/delete paths
 * reject their ids so they can never be persisted to a user's workspace row.
 *
 * This module is pure data (no DB imports) so it is safe to import from both
 * server operations and the agent executor.
 */

export interface BuiltinSkill {
  id: string
  name: string
  description: string
  content: string
}

const DEPLOY_WORKFLOW_CONTENT = `# Deploy Workflow

How to take a finished workflow and make it usable by the outside world.

## What deploying actually means

Deploying publishes a snapshot of a workflow. The version people are editing and the version that's actually live are two separate things — changes to the editable copy don't reach anyone until you deploy again. Every deploy is a saved version you can compare against or roll back to. The same workflow can be published in more than one form at once.

## The three ways to publish

- **As an API** — when the workflow is a behind-the-scenes pipeline that other software calls: data goes in, a result comes back. Best for transforms, lookups, and functions invoked by code.
- **As a chat interface** — when a person should talk to the workflow through a shareable link. Best when there's a conversational agent at the center. Note that publishing a chat also publishes an API alongside it, so you end up with both.
- **As a tool other AI agents can call** — when the workflow should show up as an action inside an AI assistant or coding environment. This needs a place for the tool to live, which can be an existing one or a new one created for it.

If the user doesn't specify: a workflow where a person sends input and an agent replies is a chat; a pure input-to-output transform with no conversation is an API; a single-purpose action meant for another AI to trigger is a tool.

## Before you deploy

- Make sure the workflow is complete and wired — it has a clear starting point and a clear ending point.
- Make sure every service it touches is connected. If a credential is missing, sort that out first rather than shipping something that breaks at runtime.
- Make sure it actually runs. Don't tell the user it works if it's never been tested.
- If it's already live, understand exactly what's changed since last time so you're deploying on purpose, not by accident.

## Doing it well per type

- **API:** publish it, then hand back the real endpoint and a working example of how to call it. Don't invent the URL.
- **Chat:** figure out which block's output should actually be shown to the user, and use the genuine output — not the friendly display label, which often isn't the real field. If the workflow can end at more than one place depending on conditions, make sure every possible ending is included so the user always sees a reply.
- **Tool for AI agents:** give it a clear name and description, describe each input plainly, and hand back setup instructions for the user's AI client.

## Options worth setting

For chat especially: a clean link slug (keep it lowercase with hyphens), a title, a description, a welcome message, and the access level — open to anyone, password-protected, or limited to specific email addresses. If you choose password or email access, you must actually supply the password or the allowed list, or access won't behave as intended.

## Keys and access

Calling a published API or AI tool needs an access key. First check whether one already exists — if it does, don't create another; just point the user to it. Only generate a new key when none exists. When you do create one, the full key is shown only once — tell the user to save it, because it can't be recovered later.

## Ways an API can be called

It can be called and waited on for the full result, called as a live stream that sends pieces as they're produced, or called as a background job that you check on later. Mention whichever fits how the user plans to use it.

## After it's live

Confirm the real status rather than assuming it's live just because a link exists. If the live copy has fallen behind the edited copy, that's worth flagging — it means recent changes aren't being served yet. You can refresh the live version to match the latest edits, change its configuration, roll production back to an earlier version, or pull an old version back into the editor to work from.

## Easy mistakes to avoid

- Showing the wrong thing in a chat because you used a display label instead of the real output — always confirm what actually comes out.
- A link slug with capitals or spaces.
- Forgetting to mention that a chat also exposes an API.
- Claiming "deployed" when the live copy is stale.
- Choosing protected access but not supplying the password or allowed emails.
- Deploying with a service still unconnected, so it fails the moment it runs.
- Generating a new access key when one already exists instead of just pointing to it.
- Losing the access key (gone for good), or fabricating a URL.
`

const CONNECT_INTEGRATION_CONTENT = `# Connect an Integration

How to connect a service and choose the right account credential.

## First, figure out how the service authenticates

Some services connect by signing in through the provider (the "log in with…" flow). Others connect with an API key you paste in. A few support both. Always check which kind a service is before doing anything — don't assume. If it supports both, mention both routes. If it's not a recognized integration at all, say so honestly instead of pretending.

## For sign-in style services

First check whether the user already has that account connected. If they do and they didn't ask for a different account, just use the existing connection — don't make them reconnect. If nothing's connected, generate a connect link and surface it so they can authorize in one click.

The most important thing here is matching the service to the correct provider identity. Services are often more specific than they look — a single broad provider name can secretly point to several different sub-services, so always connect to the precise one for the service in question rather than the generic parent. Getting this wrong hands the user a link that authorizes the wrong thing.

## For API-key style services

Tell the user plainly what key is needed and where to get it. Check whether they've already saved one. Store it as a workspace setting (use a personal one only if they ask), and from then on the workflow refers to it by name rather than embedding the secret. Don't try to push an API-key service through the sign-in flow — it won't work.

## When there's more than one account

If the user has connected several accounts for the same provider, don't guess which one to use. Show them the choices in human terms — which account, when it was connected — and let them pick. Only auto-select when there's exactly one.

## A separate kind of key

There's also a key used to call the user's own published workflows from outside. That's a different thing from connecting a third-party service — don't confuse the two.

## Easy mistakes to avoid

- Connecting to a generic provider name when the service needs a specific sub-service — quietly authorizes the wrong thing.
- Treating the service's own name as its provider identity; they're often different.
- Routing an API-key service through the sign-in flow, or vice versa.
- Assuming "connected" when the existing connection doesn't actually cover what this task needs.
- Auto-picking an account when several exist.
- Ever showing a raw key, token, or link in plain text — these should always be presented as protected, copyable credentials.
`

const RESEARCH_CONTENT = `# Research

How to research well and come back with something genuinely useful.

## Pick the right kind of source

- For a known library or framework, go straight to its official documentation — don't web-search what the docs answer authoritatively.
- For a question about this platform's own features, use the platform documentation.
- For a general topic, comparison, or anything where recency matters, search the open web; you can bias toward news, research, code, or company sources depending on the question.
- When you already know the exact pages you need, just read them — and read several at once rather than one at a time.
- For a single content-heavy page, read that page directly; only crawl across many pages of a site when you genuinely need that breadth, since it's slow and expensive.

## How to actually do it

Search broadly to find a handful of authoritative sources, then read them in depth — search snippets are leads, not answers. Favor primary and official sources over SEO blogs. Run independent lookups together instead of in sequence. When the research relates to something the user is building, ground it in their own materials so the findings actually connect to their situation.

## How to report back

Lead with the single most important takeaway, then the supporting findings — each tied to where it came from. If you can't point to a source for a claim, don't make the claim. Cross-check anything important against more than one source. Finish with what it means for the user and what to do with it, not just a pile of facts.

## When sources disagree or go stale

Pay attention to dates. For fast-moving things — pricing, APIs, model versions — trust the most recent reliable source and check it live rather than relying on memory. When there's a real conflict, show both sides and flag it instead of silently picking one. If the user is on a specific version of something, pin your research to that version. Be honest about uncertainty.

## Easy mistakes to avoid

- Defaulting to a web search for everything — libraries and platform features have better canonical sources.
- Crawling a whole site when reading a few pages would do.
- Quoting or citing a page you didn't actually read, or inventing a link.
- Burying the answer under raw information instead of synthesizing it.
- Wandering off into tangents before answering what was actually asked.
`

const CREATE_TABLE_CONTENT = `# Create a Table

How to set up structured data so it's actually useful later, not just a dump.

## Design the columns first

Decide the shape before loading anything. Give each column the narrowest correct type — text, number, true/false, date, or a nested bag for genuinely complex values. Keep numbers as numbers and dates as dates so you can actually sort and compare them later; storing them as plain text quietly breaks filtering. Mark the natural identifier (like an email or an external ID) as unique so duplicates can't sneak in. Don't hide fields you'll want to search inside a nested blob — promote them to real columns.

## Getting data in

Pick the lightest path:

- Start empty with a defined structure and fill it in afterward.
- Build the table directly from an existing data file and let it infer the structure — then sanity-check that dates and yes/no fields came through as the right type.
- Load a data file into a table that already exists, either adding to what's there or replacing it wholesale.
- When the incoming data doesn't line up neatly — needs joining, splitting, or computed columns — reshape it first, then load the clean result.

If there's no real data to load right now, seed the table with a few dummy rows that match the column types, so the structure is visible and obviously correct rather than sitting empty. Make clear they're placeholders the user can clear out.

## Querying and bulk edits

You can filter, sort, and page through rows with the usual comparisons (equals, greater/less than, "is one of," contains, and/or combinations), and send results straight out to a file when someone needs an export. For mass changes you can update or delete everything matching a condition, or apply different values across many specific rows at once. When exporting, let the format follow the file name rather than hand-building it.

## Automating per row

You can attach an existing workflow to a table so it runs once for every row, with chosen results landing in their own columns. Some columns act as prerequisites — a row only runs once those are filled. A few things to get right:

- Always confirm which real outputs a workflow produces before wiring them into columns, rather than guessing.
- Newly attached automation stays paused by default — nothing runs until you start it, which is intentional so you're not burning runs while still setting things up. Kick it off deliberately, or only auto-run immediately if the user explicitly asked for that.
- You can run a single cell, a whole row, or an entire column on demand.
- When one step should wait on another, make it depend on the column the earlier step fills, not on the step itself.

## Easy mistakes to avoid

- Loading data before the structure exists when you're filling it programmatically.
- Leaving a table completely empty when there's no data yet — seed a few placeholder rows instead.
- Letting duplicates break a whole import — surface the conflict instead of blindly retrying; switching to a full replace fixes clashes with existing rows but not duplicates within the new data itself.
- Treating ordinary pre-import warnings (a missing or unmapped required column) as failures — they're usually a quick fix.
- Overflowing the table's row limit when adding to existing data.
- Wondering why "nothing ran" — attached automation is paused on purpose until you start it.
- Wiring columns to outputs you assumed existed instead of confirming them.
- Acting on rows by name instead of nailing down the exact table and rows first.
`

export const BUILTIN_SKILLS: readonly BuiltinSkill[] = [
  {
    id: 'builtin-connect-integration',
    name: 'connect-integration',
    description: 'How to connect a service and choose the right account credential.',
    content: CONNECT_INTEGRATION_CONTENT,
  },
  {
    id: 'builtin-research',
    name: 'research',
    description: 'How to research well and come back with something genuinely useful.',
    content: RESEARCH_CONTENT,
  },
  {
    id: 'builtin-create-table',
    name: 'create-table',
    description: "How to set up structured data so it's actually useful later, not just a dump.",
    content: CREATE_TABLE_CONTENT,
  },
  {
    id: 'builtin-deploy-workflow',
    name: 'deploy-workflow',
    description: 'How to take a finished workflow and make it usable by the outside world.',
    content: DEPLOY_WORKFLOW_CONTENT,
  },
] as const

const BUILTIN_BY_ID = new Map<string, BuiltinSkill>(BUILTIN_SKILLS.map((s) => [s.id, s]))
const BUILTIN_BY_NAME = new Map<string, BuiltinSkill>(
  BUILTIN_SKILLS.map((s) => [s.name.toLowerCase(), s])
)

export function isBuiltinSkillId(id: string): boolean {
  return BUILTIN_BY_ID.has(id)
}

export function getBuiltinSkillById(id: string): BuiltinSkill | undefined {
  return BUILTIN_BY_ID.get(id)
}

export function getBuiltinSkillByName(name: string): BuiltinSkill | undefined {
  return BUILTIN_BY_NAME.get(name.toLowerCase())
}
