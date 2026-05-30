/**
 * Base class for domain errors that map to a specific HTTP status when they
 * bubble up unhandled through `withRouteHandler`. Modeled after NestJS
 * `HttpException` / Spring `ResponseStatusException`: subclasses declare a
 * concrete `statusCode`, and the centralized route wrapper uses an
 * `instanceof HttpError` check (not duck-typing on a `statusCode` property)
 * to decide whether to forward the error's `message` to the client.
 *
 * Using a class check prevents third-party errors that happen to carry a
 * `statusCode`-shaped field from being treated as typed HTTP errors and
 * leaking internal details.
 *
 * Subclasses MUST ensure that `message` is safe to expose to clients — no
 * stack traces, secrets, file paths, ORM internals, or upstream provider
 * details.
 */
export abstract class HttpError extends Error {
  abstract readonly statusCode: number
}
