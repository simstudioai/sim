/**
 * Ids of tools that no longer exist in the catalog but still appear in
 * persisted chat history.
 *
 * A retired tool stops being generated into `tool-catalog-v1`, so any render
 * path that referenced its generated constant would fail to compile — and
 * deleting those paths instead would silently downgrade every historical
 * transcript that contains one. These literals keep replay intact without
 * implying the tool is callable: nothing dispatches them, and no agent is
 * offered them.
 */

/**
 * Retired with the browser takeover flow. The browser panel is live and shared
 * — the user can act in it whenever they want — so there was never anything to
 * hand over, and the agent no longer has a concept of taking or returning
 * control. Chats from before the removal still contain takeover cards.
 */
export const RETIRED_BROWSER_REQUEST_TAKEOVER_ID = 'browser_request_takeover'
