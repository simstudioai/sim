/**
 * User-Agent sent on every Reddit API request.
 *
 * Reddit's API rules require a unique, descriptive User-Agent in the shape
 * `<platform>:<app ID>:<version string> (by /u/<reddit username>)` and state that
 * generic defaults "are drastically limited" in rate to discourage them
 * (reddit-archive/reddit wiki, "API Access" / "Rules").
 *
 * The contact suffix carries the project URL rather than a `/u/` handle because
 * Sim does not own a Reddit account to name, and the same rules ban lying in the
 * User-Agent. Substitute `(by /u/<handle>)` once a Sim developer account exists.
 *
 * Bump the version segment when Reddit-facing request behavior changes so Reddit
 * can attribute and, if needed, block a specific release.
 */
export const REDDIT_USER_AGENT = 'web:ai.sim:v1.0.0 (+https://github.com/simstudioai/sim)'
