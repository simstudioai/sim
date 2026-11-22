/**
 * The warnings a check fails on as errors: an apply saves each as written although the block it
 * names is broken. One table, so `check --help` and the directory guides name the same findings.
 */

import type { DiagnosticCode } from '@sim/workflow-code/diagnostics/codes'

/** Each strict warning code with what it finds, as the guides phrase it. */
export const STRICT_FINDINGS: ReadonlyMap<string, string> = new Map([
  ['W_REQUIRED_MISSING', 'a missing required field'],
  ['W_UNKNOWN_OPTION', 'an unknown option'],
  ['W_UNKNOWN_OUTPUT_PATH', 'an unknown output path'],
  ['W_VALUE_KIND', 'a wrong value kind'],
  ['W_OUT_OF_RANGE', 'an out-of-range value'],
  ['W_LITERAL_SECRET', 'a literal secret'],
  ['W_TABLE_UNKNOWN_COLUMN', 'a table write to an unknown column'],
  ['W_CHILD_INPUT_UNKNOWN', 'an input a child workflow does not declare'],
  ['W_CHILD_RESULT_PATH', "a path a child workflow's result does not hold"],
  ['W_BRANCH_UNWIRED', 'an unwired condition or router branch'],
  ['W_UNRESOLVED_REF', 'a reference that names nothing'],
  ['W_REF_OUT_OF_SCOPE', 'an iteration field read outside its loop or parallel'],
  ['W_LOOP_CONDITION_SYNTAX', 'a loop condition that is not a JavaScript expression'],
] satisfies Array<[DiagnosticCode, string]>)

const phrases = [...STRICT_FINDINGS.values()]

/** Every {@link STRICT_FINDINGS} phrase as one clause: `a, b, … or z`. */
export const STRICT_FINDINGS_CLAUSE = `${phrases.slice(0, -1).join(', ')} or ${phrases.at(-1)}`
