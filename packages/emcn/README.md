# EMCN

EMCN is Sim's modern shared component system, derived from the new Platform UI. Auth, Docs and Platform share its foundations while retaining their own page composition and reading density. Landing can adopt these foundations and conventions in its separate codebase.

| Package | Owns |
| --- | --- |
| `@sim/emcn` | Shared controls, icons, feedback, scrolling, typography and style foundations |
| `@sim/emcn-auth` | Auth shells, identity and consent compositions |
| `@sim/emcn-docs` | Documentation content, code and reference compositions |
| `@sim/emcn-platform` | Chat, workspace and Platform page compositions |
| `@sim/emcn-legacy` | Compatibility for unreplaced application routes; never a modern dependency |

## Frozen surface

The public surface of `@sim/emcn`, `@sim/emcn-auth`, `@sim/emcn-docs` and `@sim/emcn-platform` (export subpaths, exported names, component props and their variant values, CSS Module classes) is recorded in `scripts/emcn-surface.json`, and `bun run check:emcn-surface` fails on any difference. Only the design owner (CODEOWNERS) changes these packages or regenerates the snapshot. Product code composes the components as they stand; a part a second feature needs moves to the nearest shared product owner (`apps/sim/app/(product)/_components/`). Legacy UI stays custom or `@sim/emcn-legacy`.

## Component structure

Use a family import such as `@sim/emcn/button`, `@sim/emcn/field`, `@sim/emcn-auth/shell` or `@sim/emcn-docs/code-block`. Supporting modules have explicit subpaths. Each family has its own folder containing the implementation, CSS Module and private helpers. Only barrels re-export siblings. Components do not import application data, route configuration or fixture logic.

The field family barrel exposes FieldFrame and fieldDescription from `field/frame.tsx` alongside the labeled controls. Picker frames render the appropriate Base UI label inside its root; ordinary input labels remain native. This keeps caption clicks from synthesizing a second activation of a button trigger.

Pass `disabledReason` to Button, Checkbox or supported picker triggers/options when a restriction is not evident from the surrounding form. It shows the existing tooltip on hover, keyboard focus or a touch tap without enabling the control. DataTable rows supply `selectionDisabledReason` beside `selectionDisabled`. Tooltip preserves the control's label or labelled-by association for its disabled focus target; explanations stay descriptions, separate from the control name.

A different label, icon, viewport or value never calls for another visual variant. Keep distinct keyboard and semantic contracts even when controls share paint.

## Styles

Each surface has one public CSS entry: Auth's `auth.css`, Docs' `docs.css` and Platform's `platform.css`. These import `@sim/emcn/styles/global.css`. Component CSS Modules remain beside their owners. Shared foundations publish colors, typography, spacing and semantic rhythm, sizes, borders, radii, materials, elevation, selection, disabled states, fades and motion. Surface files alias those roles and own justified differences such as Docs reading measure or Auth form groups.

Generated Shared token/type recipes live under `styles/generated`; their compiler preserves source provenance. `global.css` publishes convenient `--emcn-*` aliases and `component-roles.css` owns shared control roles. `theme.css` is compile-time Tailwind metadata, imported only by a standalone app bootstrap or referenced by a component. Shared runtime styles are scoped to `[data-emcn]`; the Platform root additionally retains `[data-platform-ui]`. Popups inherit the active surface and nearest native dialog. No surface entry introduces global preflight.

Parents own spacing through flex/grid gaps. Auth group rhythm is 20px on desktop and 24px on compact screens, with 8px between actions. Common control/row roles use the named scale rather than local measurements. Auth and Docs focus keep resting paint and retain semantic selected/error/highlighted states. Platform retains its existing keyboard-focus policy, including the embedded host outline. Overflow fades are 16px only at hidden-content edges. Color and position motion use 120ms, reduced to zero under reduced motion; copied/transient confirmation feedback dwells for four seconds.

One font asset owner serves Next and Electron. Unique `EMCN Geist` and `EMCN Geist Mono` CSS families avoid changing an older page when its styles remain loaded after client navigation.

## Compatibility and verification

Old components retain their separate `@sim/emcn-legacy` identity until their routes are replaced. The new packages cannot import them. Docs' existing workflow-canvas renderer is a scoped content adapter; it does not supply Docs chrome. Platform's data seam may resolve legacy toast calls through its explicit toast-only shim, with no legacy UI in the resulting runtime graph.

Run the package type-checks, `check:emcn-surface`, `check:platform-design`, `check:platform-css`, and the affected production browser/Electron suites. Check both supported themes, intermediate widths, text scaling, wrapped content, keyboard/pointer interaction and actual overflow. Auth remains light-only. A successful build or a passing gallery alone does not establish rendered consistency.
