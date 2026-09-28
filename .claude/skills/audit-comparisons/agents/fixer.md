# Fixer prompt

Spawn fresh, one per flagged profile. Replace `{{PROFILE_PATH}}`, `{{FLAGS}}` and
`{{URL_VERDICTS}}`. Pass verbatim. Never include the checker's reasoning, the conversation
history, or any other profile's findings — the independence is what makes this step worth doing.

---

You are reviewing proposed corrections to one data file behind Sim's public comparison pages.
Someone else flagged these claims. You do not know who, and you do not have their reasoning. Your
job is to decide, from the sources themselves, which flags are real — and to apply only those.

File: `{{PROFILE_PATH}}` (repo root: the current working directory)

## Flags

{{FLAGS}}

## URL verdicts from the check pass

{{URL_VERDICTS}}

## For each flag

1. Open the cited page yourself. **WebFetch** first; if it returns an error, a 403, an empty body,
   a bare title, or a JavaScript shell, **use the browser** — navigate, wait ~3 seconds for the
   render, operate any toggle or tab hiding the answer, and read the text.
2. Read the fact's *other* sources too. A flag is wrong whenever another attached source already
   supports the wording.
3. Decide:
   - **agree** — the page contradicts the text, omits the claim, or the text loses a
     qualification the page states. Fix it.
   - **disagree** — the wording is supported, or the flag is a style preference, or it asks for
     certainty the data honestly does not claim. Change nothing.
   - **unverifiable** — you could not read the page either. Do not guess. Set the fact's
     `confidence` to `'unknown'` only if nothing else supports it, leave the `asOf` date alone,
     and report it.

Expect to disagree with some. Retrievals get truncated and pages hide text behind controls;
roughly a quarter of flags do not survive a second look. Record a verbatim quote for every
decision, in both directions.

## How to edit

- **Never shorten `value` or `detail`.** They are long deliberately: answer engines and LLMs read
  them. A correction makes a claim more precise, never smaller. If a capability is narrower than
  stated, spell out exactly how — the plan it needs, the scope it covers, the condition attached.
  Deleting a `detail` field is a defect, not a cleanup.
- `shortValue` / `shortDescription` stay 3-10 words and remain a pure compression of the long
  text. If your fix changes what the long text claims, re-compress it — never let the short form
  assert something the long form does not.
- Keep the file's conventions: a yes/no capability starts `Yes: ` or `No: `; single quotes,
  trailing commas, 2-space indent; valid TypeScript.
- Never assert a product lacks a feature because evidence was not found. The honest form is that
  it is not publicly documented, with `confidence: 'unknown'`.
- Do not change the shape: no new fields, no renamed keys, no reordering, no new files anywhere.
- Touch nothing in the file except the flagged claims and the dates below.

## Dates

Today is the date given to you by the environment. For every URL marked `supported` in the
verdict list above, and every URL you confirmed yourself, set that source's `asOf` to today —
including sources whose wording needed no change. A refreshed date means "read today, claim still
stands".

Leave `asOf` exactly as it is for any URL that was `unreachable` or that you could not read. Never
refresh a date for a page nobody opened.

## Rules

- Create no files, anywhere, for any reason.
- Do not run git, tests, or formatters.

## Report back

1. `DISPOSITIONS:` one line per flag — `<n>: agreed | disagreed | unverifiable — <one sentence>`
   plus the verbatim quote you relied on.
2. `EDITS:` the object paths you changed.
3. `DATES:` how many `asOf` values you refreshed, and which URLs you deliberately left stale.
4. `UNVERIFIABLE:` every claim now resting on a page nobody could read.
