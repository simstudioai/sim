# Local Studio fixtures

`studio:refresh` checks generated design contracts, scans the checkout, and publishes external capture evidence. Run `design:generate` after changing its source inputs. The catalog discovers public exports and finite variant values automatically; new components remain `needs-fixture` until an adapter mounts them.

## Adapter coverage

`tools/design-studio/_components/component-fixtures.tsx` supplies fixed props, data, and providers. The matching switch case must render each supported export by its actual JSX name. Icons use the generic namespace adapter.

`fixture-contracts.json` declares coverage separately for each public export:

- `variants` lists the axes that the adapter forwards to that export. New values on a covered axis appear automatically. A new axis requires review and a mapping; spreading variant props does not establish coverage. Axes requiring different data shapes need their own fixture data before being listed.
- `states` lists supported focus, disabled, error, and open states. Open captures require a visible popup or dialog.
- Disabled variants omit open and focus states; explicitly closed variants omit open states. Both retain their default preview, and combined live selections apply the same restrictions.
- `defaultStates` opens otherwise hidden exports, such as tooltip content or a wizard step, for their default specimen.
- `requiredElements` identifies a visible element belonging to a hidden or nested export. Use a unique fixture marker when a generic role could match its parent.

Update fixture imports and switch cases when exports are renamed or removed. Product Extras require a maintained source mapping for a real component preview; automatically generated style samples are indicative.

## Capture and live evidence

All checkout changes invalidate sample captures until a complete rendering dependency graph is available. This conservatively covers imported CSS, fonts, configuration, and dependency declarations.

Studio live previews render the current checkout. Their options and capture status come from the last published refresh. Source mismatches are shown beside the preview and above the catalog. Unresolved styling/control analysis and scanner limits remain separate from inspection failures and successful rendering.

## Focused browser verification

Start the isolated fixture app on an unused loopback port, then run:

```sh
SIM_STUDIO_E2E_URL=http://127.0.0.1:3002 \
SIM_STUDIO_E2E_REPORT_PATH=/absolute/external/report.json \
bun --no-env-file scripts/design-studio/test-fixtures-e2e.mjs
```

The report records each result and screenshot for both themes and 16px/20px root sizes. `SIM_STUDIO_E2E_CASE` optionally selects comma-separated fixture IDs. Full refresh should run against frozen source after integration.
