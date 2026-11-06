---
description: One pattern per job across the organization views (Settings, People, Integrations, Links, Home)
paths:
  - "apps/sim/platform/app/(shell)/{settings,people,integrations,links,home}/**"
  - "apps/sim/platform/design-system/components/{status,modal,picker,settings-section,search-field,activity-row}/**"
  - "apps/sim/app/o/*/**"
---

# Organization Views

The organization views live in `apps/sim/platform/app/(shell)/` and take everything shared from
`@/platform/design-system/components`. Each job below has one pattern. A view that differs needs a
reason written where it differs; "it was already like that" is not one.

| Job | Use | Never |
| --- | --- | --- |
| First read of a view | `QueryBoundary` (`query`, `failure`, `loadingLabel`, optional `empty`, `loading`), which renders `LoadingRows`, then `FailureNotice`, then `empty`, then `children(data)` | Inline `isPending ? … : error ? …`, a raw `<p>Loading…</p>`, a loading `InlineNotice` |
| Loading | `LoadingRows` by default. A placeholder shaped like its content (`WidgetSkeleton`, usage charts) only where rows would misrepresent it | A second generic skeleton |
| Failed read | `FailureNotice`, labelled Retry. `intent='warning'` where the read partly answered | A hand-built retry button or `InlineNotice` + `Button` |
| Failed background refresh | `FailureNotice` outside the boundary, over the content it keeps | Replacing content already on screen |
| Empty | `EmptyState`, with no create button when the page already has one. A picker's no-match line inside a dialog stays `Muted`, since a block would take over the dialog | `Muted` or a raw `<p>` anywhere else |
| Confirm | `ConfirmDialog` (`target`, `title`, `confirmLabel`, `pendingLabel`, `onConfirm`, `safe` when nothing is lost). Removing a person, revoking an invite and any destructive row action always ask first | `Modal variant='confirm'`, `window.confirm`, an unconfirmed destructive action |
| Save | `SaveActions`, end-aligned in the page flow under the fields it commits: Discard while dirty, then Save. Save is visible and disabled while clean | Save in a header, Save before Discard, a Cancel beside Discard |
| Editing a server value | `useServerDraft`. Adopts a newer value while clean; while dirty it keeps the edits and sets `conflict`. Show `DraftConflictNotice`, and block Save until the viewer chooses | Seeding `useState` from a query once |
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

Every page under `app/o/[organizationId]` calls
`requireOrganizationViewer(organizationId, callbackUrl)` from `@/app/o/[organizationId]/viewer`. It
redirects a signed-out viewer to sign-in and back, 404s a viewer with no access, and returns
`{ userId, principal, surface }`. Never write `{ kind: 'session', ... }` in a page.

## Dialogs

`Modal` holds itself open while `onConfirm`'s promise or its `pending` prop runs. Escape, the backdrop
and Close do nothing until it settles, including when the browser closes the `<dialog>` itself: once
user activation is spent, `cancel` cannot be prevented, so `OverlayDialog` reopens from `close`.

## Files

- A section with more than one job splits by job: `group-detail.tsx` is the shell, `group-general-tab.tsx`
  and `group-catalog-tabs.tsx` its bodies, `use-group-draft.ts` its write.
- Merge logic worth a test is a pure module next to the view, such as `secrets-draft.ts`.
- `section-parts/` holds what only settings needs: `SectionStack`, `FieldStack`, `SectionToolbar`,
  `DetailHeader`, `HeadingRow`, `Muted`, `SectionSkeleton`, `DraftConflictNotice`. `useServerDraft` is in `_components/`, since Integrations uses it too.

## Legacy workspace settings

`apps/sim/app/workspace/*/settings/**` keeps `SettingsPanel` from `@/components/settings/settings-panel`,
which owns chrome through `settings/[section]/layout.tsx`. The `add-settings-page` skill describes it.
New organization work never imports it.
