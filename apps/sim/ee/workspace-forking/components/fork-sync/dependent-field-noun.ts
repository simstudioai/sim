/**
 * Leading imperative verb on a field title. Titles are labels, and some already read as an
 * instruction ("Select Issue", "Choose Project"), so composing surrounding copy onto them
 * verbatim produces "Select select issue". The trailing `\s+` is load-bearing: it stops
 * "Selected Files" and "Selection" from being mangled into "ed Files" / "ion".
 */
const LEADING_IMPERATIVE_VERB = /^(?:select|choose|pick)\s+/i

/**
 * The bare noun of a dependent field's title, for copy that supplies its own verb
 * ("Select {noun}", "Search {noun}...", "No {noun} found").
 *
 * Falls back to the whole title when stripping would leave nothing — a title that is only a
 * verb has no noun to extract, and an empty noun would render "Select " and "No  found".
 */
export function dependentFieldNoun(title: string): string {
  const stripped = title.replace(LEADING_IMPERATIVE_VERB, '').trim()
  return (stripped || title).toLowerCase()
}
