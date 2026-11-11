---
description: UI copy conventions — no default subtitles or helper text under headings, labels, cards, or settings
paths:
  - "apps/sim/components/**/*.tsx"
  - "apps/sim/ee/**/*.tsx"
  - "apps/sim/app/_shell/**/*.tsx"
  - "apps/sim/app/(interfaces)/**/*.tsx"
  - "apps/sim/app/(site)/**/*.tsx"
  - "packages/emcn-legacy/**/*.tsx"
---

# UI Copy

**Do not add subtitles, helper text, or descriptive copy beneath headings, labels, cards, or settings by default.** Prefer one concise, self-explanatory heading or label. Only add supporting copy when the user explicitly asks for it, or when it is necessary to prevent misunderstanding or error — and never use it to restate the heading.

This applies to app UI outside the Platform: settings rows, modals, panels, cards, list rows, empty states, form fields, and section headers. Platform views (`app/(product)`, `platform`) follow the stricter one-line-per-control rule in `apps/sim/platform/AGENTS.md`, which `check:platform-design` enforces (`helper-copy`); marketing surfaces (`app/(landing)`, docs) follow `constitution.md`.

## Platform copy vocabulary

Platform views also share one vocabulary, documented in `apps/sim/platform/AGENTS.md` (Code-first product design) and enforced by `check:platform-design`:

- **Sentence case** for every literal `title`, `label` and `*Label` prop (`confirmLabel`, `createLabel`, …), for `label`s and `*Label`s in menu, column, sort, command and action data, and for button, menu item and chip text (`copy-case`). Product, plan and brand names keep their capitals through `PROPER_NOUNS` / `PROPER_PHRASES` in `scripts/platform-source-rules.ts`; a page or tab name inside a label is a common noun ("Open logs", "Switch to runs").
- **The `…` glyph**, never three periods, in rendered copy and in object or record values such as status labels (`copy-ellipsis`).
- **Confirmations** go through `ConfirmDialog` with a real `pendingLabel` ("Deleting…"), `safe` when nothing is lost (`confirm-owner`). Titles are "{Verb} {noun}" with no question mark, identical for one object everywhere; unsaved changes read "Unsaved changes" / "Discard".
- **Verbs**: editing saves with "Save", creating says "Create {noun}", adding a connection or credential says "Add {noun}", OAuth keeps "Connect".
- **Empty and no-results**: an empty list is `EmptyState` (`Muted` in a narrow rail or dialog picker); no results read "No matching {noun}", the query in curly quotes, no period.
- **Back, tabs, alerts, tooltips** belong to their owners: `DirectoryBack` / `DetailHeader` with bare-noun labels (`back-owner`), `ContentTabs` (`tab-owner`), `InlineNotice` / `FailureNotice` / a field's `error` (`alert-owner`), and `Tooltip` / `OverflowText` rather than a native `title=` (`native-title`). Statuses use Logs' words: a failed run reads "Failed".

**Carve-out — settings section metadata.** `SettingsNavigationItem.description` in `components/settings/navigation.ts` stays required, and `SettingsPanel` keeps rendering it as the page subtitle. Settings sections are reached through a nav list where the description is the only thing distinguishing adjacent sections, so it earns its place by the "prevents misunderstanding" test. Keep those descriptions verb-first and one line, per `sim-settings-pages.md`. Everything else on a settings page — inline `<p>` blurbs under section headings, field hints, modal bodies, row subtitles — follows the default rule above.

## The default is no description

```tsx
// ✗ Bad — the subtitle restates the heading
<h3>API Keys</h3>
<p className='text-[var(--text-muted)] text-caption'>Manage your API keys.</p>

// ✗ Bad — decorative filler under a field label
<ChipModalField title='Workspace name' hint='The name of your workspace.' />

// ✓ Good — the label carries the whole meaning
<h3>API Keys</h3>
<ChipModalField title='Workspace name' />
```

If a heading needs a subtitle to be understood, the heading is wrong. Fix the heading — don't append a second line. For a field, bake the meaning into the line itself first: a format into the placeholder (`us-gov-west-1`), a bound or scope into the label (`Idle timeout (hours, min 1)`), a trade-off into the option (`Access keys (long-lived)`), or point to the dialog's setup guide.

## When supporting copy earns its place

Keep (or add) a description only when it carries information the label cannot, and its absence would cause a mistake:

- **Irreversible or destructive consequences** — "Deleting this workspace removes every workflow and log. This cannot be undone."
- **A non-obvious format, unit, or bound the label, placeholder and options cannot hold** — "Comma-separated. Max 50 domains.", "Cost per 1M input tokens."
- **A security or access implication** — "This key is shown once and grants full workspace access."
- **A state the user cannot otherwise see** — "Inherited from your organization's policy."
- **Instructional copy that advances a flow** — "We sent a 6-digit code to you@example.com."

Everything else — restatements, "Manage your X", "Configure your Y", feature blurbs, encouragement — gets deleted.

## Component APIs

Description/hint slots on shared components are **optional**, never required, and must reserve no layout space when omitted. A component that forces every consumer to supply a subtitle forces every consumer to violate this rule. EMCN is frozen, so a new shared component lives with its nearest product owner (`packages/emcn/AGENTS.md`); ship it without a description slot and add one only once a real caller meets the bar above.
