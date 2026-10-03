# Recorded PitchBook responses

Response bodies recorded in PitchBook's published Postman collection
("Public API V2 Documentation"), one per implemented endpoint, keyed by tool id.

These are the ground truth every tool's `outputs` was derived from, and
`pitchbook.test.ts` replays each one through its tool's `transformResponse` to
assert the produced keys still match the declared outputs.

Long arrays are truncated to three items and long strings to 400 characters —
the tests assert shape, not volume. Regenerate from the collection if an
endpoint's contract changes.
