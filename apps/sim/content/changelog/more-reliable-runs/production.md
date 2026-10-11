# Reliability improvements: editorial candidate

Status: draft; select for a themed edition rather than publishing solely because v0.9.14 shipped.
Feature owner: assign in the publication PR. Editor: assign in the publication PR.

## Story selection

The source is [v0.9.14](https://github.com/simstudioai/sim/releases/tag/v0.9.14). The current draft combines code handling, file provenance, and background confirmations. Confirm a clear audience and a practical example before treating that collection as a standalone story. Otherwise, move the relevant notes into a related feature edition and keep the remaining changes in the technical history.

## Media assessment

`/blog/secret-provenance/cover.jpg` is the existing secret-provenance article's illustration. It is not a product screenshot and does not demonstrate the new export or archive behavior. It may illustrate the broader subject, but it is insufficient as the sole evidence for this release. Keep the entry in draft.

If file provenance becomes the lead story, demonstrate an export or archive extraction with safe sample files and the actual resulting origin information in Sim. Capture only information the product exposes. Alternatively, use an explicitly labeled explanatory diagram whose transformations have been verified against the feature implementation. Link to the [secret provenance article](https://www.sim.ai/blog/secret-provenance) and [Files guide](https://docs.sim.ai/files/using-in-workflows).

Do not invent a speedup percentage or synthetic before-and-after timing for the code-handling improvement. Any performance claim needs a repeatable measurement and stated workload.

## Completion criteria

- [ ] Editor selects one meaningful lead story or folds these notes into a related edition.
- [ ] Feature owner verifies the demonstrated behavior and deployed availability.
- [ ] The article has a relevant, reviewed image or video; cover and caption describe it accurately.
- [ ] Capture environment, date, steps, source asset, and final filenames are recorded here.
- [ ] Links, mobile readability, content audit, and distribution copy are reviewed.
