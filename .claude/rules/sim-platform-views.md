---
description: One pattern per job across the Platform's organization and workspace views (Settings, People, Integrations, Home, workspace tabs)
paths:
  - "apps/sim/app/(product)/**"
  - "apps/sim/platform/lib/**"
  - "apps/sim/platform/shared/**"
  - "packages/emcn/src/components/{status,modal,picker,settings-section,search-field,activity-row}/**"
---

# Platform Views

The product's views live in `apps/sim/app/(product)/`: organization pages under `o/[organizationId]/`,
workspace pages under `workspace/[workspaceId]/`, and what they share in `_components/`. They take
everything shared from the EMCN family subpaths (`@sim/emcn/<family>`, `@sim/emcn-platform/<family>`).
`apps/sim/platform/AGENTS.md` is the design contract; this file is the per-job checklist. Each job
below has one pattern. A view that differs needs a reason written where it differs; "it was already
like that" is not one.

| Job | Use | Never |
| --- | --- | --- |
| First read of a view | Render nothing for data-backed content while pending (static chrome renders at once), `FailureNotice` when the read fails, `EmptyState` when it settles empty. Read the query's `status`, not an empty list | A skeleton, shimmer, placeholder rows or loading copy; treating empty as loading |
| Failed read | `FailureNotice`, labelled Retry. `intent='warning'` where the read partly answered | A hand-built retry button or `InlineNotice` + `Button` |
| Failed background refresh | `FailureNotice` above the content it keeps | Replacing content already on screen |
| Empty | `EmptyState`, with no create button when the page already has one. A picker's no-match line inside a dialog stays `Muted`, since a block would take over the dialog | `Muted` or a raw `<p>` anywhere else |
| Confirm | `ConfirmDialog` (`target`, `title`, `confirmLabel`, `pendingLabel`, `onConfirm`, `safe` when nothing is lost). Removing a person, revoking an invite and any destructive row action always ask first | `Modal variant='confirm'`, `window.confirm`, an unconfirmed destructive action |
| Save | `SaveActions`, end-aligned in the page flow under the fields it commits: Discard while dirty, then Save. Save is visible and disabled while clean | Save in a header, Save before Discard, a Cancel beside Discard |
| Autosave vs Save | One or the other per page. A page with `SaveActions` holds every field in one draft and writes it in one request. List actions with their own dialog, such as adding or removing a member, are not field edits | A page mixing both |
| Create | A primary compact button in `SectionToolbar`, or in the page header on a page with one | Create in both the toolbar and the empty state |
| Search over a section's rows | `SectionSearch subject='members'` | `SearchField` with its own copy, unless the search covers more than the subject's name |
| Row | `ActivityRow` for a row that opens something, `SettingsRow` for a row holding a control | A hand-built row |
| List of rows | `RowList` (`dividers` for a list read as one block). `ActivityRow density='comfortable'` in settings | `calc(-1 * var(--ui-row-inset))` around a list; styling a row's height from outside |
| Row actions | `ActionMenu` with icon `I108`, destructive item last with a separator | The same action in the row and its menu |
| Section heading | `SettingsSection title` (h2), `DetailHeader` for a sub-view's way back | A hand-written heading |
| Toolbar | `SectionToolbar grow={<SectionSearch />}` with its actions as children | A hand-built flex row |

## Failure feedback

- Form validation is inline, on the field (`error`), once a save has been attempted.
- A dialog's own action failing stays in the dialog: `Modal` shows a rejected `onConfirm`'s message and keeps the draft.
- Any other action failing is a toast. Nothing fails silently.

## Page gates

Each page reads `resolvePlatformMode()` (`@/platform/lib/data/mode`) and loads the data seam with a
dynamic import only in `live` mode. The shell (`_components/live-shell/live-shell.tsx`) already sent
a signed-out viewer to sign-in and answered failed surface reads. `o/[organizationId]/layout.tsx` and
`workspace/[workspaceId]/layout.tsx` authorize their resource and answer not found for a viewer
without access; a page adds only its own gate (People's `requirePeopleAccess`, a Settings section's
entry in `apps/sim/platform/lib/data/settings-navigation.ts`). Never write `{ kind: 'session', ... }` in a page.

## Dialogs

`Modal` holds itself open while `onConfirm`'s promise or its `pending` prop runs. Escape, the backdrop
and Close do nothing until it settles, including when the browser closes the `<dialog>` itself: once
user activation is spent, `cancel` cannot be prevented, so `OverlayDialog` reopens from `close`.

## Files

- A section with more than one job splits by job into sibling files, as `settings/_components/sections/access-control/`
  does (`group-detail.tsx`, `permission-rows.tsx`, `add-members-modal.tsx`).
- `_components/settings-parts/` holds what organization and workspace Settings share: `SectionStack`, `FieldStack`,
  `SectionToolbar`, `DetailHeader`, `Muted`, `ResourceList`, and the saved-preference rows in `saved-settings.tsx`.

## Non-UI code lives once

A view's data and logic belong in `apps/sim/platform/lib/data`, and in `apps/sim/platform/shared` when
the helper is pure and takes what differs as an argument. Merge logic worth a test is a pure module there
with its test beside it (`apps/sim/platform/lib/data/home-model.ts`). A view reads hooks through that layer; a real adapter
owns the mutation, its toasts and any mapping, and is never a re-export. `platform/lib` never imports a
route at runtime (`check:boundaries`).
