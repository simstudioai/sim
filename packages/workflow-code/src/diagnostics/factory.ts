import { type SeverityOf, severityOf } from './severity'

/**
 * A finding of `code` with its severity filled in from the code's prefix, so no caller writes a
 * severity by hand. `extras` (a hint, a span, a block key, …) follow the message. Nothing is
 * truncated here: lists and text are bounded once, where findings leave the process
 * (`boundAnswerFindings`).
 */
export function diagnostic<C extends string, E extends object = Record<never, never>>(
  code: C,
  message: string,
  extras?: E
): { code: C; severity: SeverityOf<C>; message: string } & E {
  return { code, severity: severityOf(code), message, ...(extras as E) }
}
