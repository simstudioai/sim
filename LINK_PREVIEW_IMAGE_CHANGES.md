# Link Preview Image URL Feature

## Summary

Extended the `/api/link-preview` endpoint to extract and return image URLs from Open Graph and Twitter meta tags. The implementation supports both absolute and relative image URLs, with proper URL resolution and error handling.

## Changes Made

### 1. API Contract (`apps/sim/lib/api/contracts/link-preview.ts`)

- Added `imageUrl: z.string().nullable()` field to the `linkPreviewResponseSchema`
- The `LinkPreview` type now includes `imageUrl` which consumers can access

### 2. API Route (`apps/sim/app/api/link-preview/route.ts`)

- Added `IMAGE_URL_MAX_CHARS` constant (2048 characters)
- Updated `parsePreview` function to:
  - Accept a `baseUrl` parameter for resolving relative URLs
  - Extract image URL from `og:image` or `twitter:image` meta tags (in that order)
  - Resolve relative URLs to absolute URLs using the `URL` constructor
  - Handle invalid URLs gracefully (returns null on parse error)
  - Truncate long image URLs to the maximum allowed length
  - Return a preview object with `imageUrl` field
- Updated `fetchPreview` to pass the base URL to `parsePreview`
- Modified the null check to include `imageUrl` (returns null only if all fields are empty)

### 3. Tests (`apps/sim/app/api/link-preview/route.test.ts`)

Created comprehensive test suite covering:

#### Authentication & Rate Limiting
- Unauthenticated users receive 401
- Rate limiting is enforced correctly

#### URL Validation
- Missing, empty, invalid, and too-long URLs return 400
- Non-HTTPS URLs return null preview without fetching

#### Image URL Extraction
- Extracts absolute `og:image` URLs
- Extracts absolute `twitter:image` URLs when `og:image` is missing
- Prefers `og:image` over `twitter:image` when both exist
- Resolves relative image URLs (e.g., `/images/photo.jpg`) to absolute
- Resolves protocol-relative URLs (e.g., `//cdn.example.com/image.jpg`)
- Returns null `imageUrl` when missing
- Returns null `imageUrl` when URL resolution fails
- Truncates image URLs exceeding maximum length
- Returns preview with only `imageUrl` when no other metadata exists

#### Caching Behavior
- Returns cached previews when available
- Caches successful fetches with 24-hour TTL
- Caches failed fetches with 1-hour TTL
- Handles Redis read/write failures gracefully
- Works when Redis is unavailable

#### Fetch Failures
- Returns null preview on network errors
- Returns null preview for non-2xx status codes
- Returns null preview for non-HTML content types
- Returns null preview when no metadata is found

#### Complete Metadata
- Extracts all fields (title, description, siteName, imageUrl) correctly

## Implementation Details

### URL Resolution

The implementation uses JavaScript's built-in `URL` constructor to handle URL resolution:

```typescript
const resolvedUrl = new URL(rawImageUrl, baseUrl)
```

This correctly handles:
- Absolute URLs: `https://example.com/image.jpg` → unchanged
- Relative URLs: `/images/photo.jpg` → `https://example.com/images/photo.jpg`
- Protocol-relative: `//cdn.example.com/image.jpg` → `https://cdn.example.com/image.jpg`

### Error Handling

When image URL resolution fails (e.g., invalid URL format):
- Logs a warning with truncated URL for debugging
- Sets `imageUrl` to `null` in the response
- Does not fail the entire preview (other fields still returned)

### Backward Compatibility

The changes are fully backward compatible:
- Existing consumers get the new `imageUrl` field automatically (typed as nullable)
- Components not using the image URL continue to work unchanged
- The `useLinkPreview` hook automatically includes the new field in its response type

## Testing

All tests follow the project's testing standards:
- Use `@vitest-environment node`
- Mock global dependencies properly
- Clear mocks between tests
- Test both success and failure paths
- Verify authentication, rate limiting, and caching behavior

Run tests with:
```bash
bun test apps/sim/app/api/link-preview/route.test.ts
```

## Future Enhancements

The `ExternalLink` component (`apps/sim/app/workspace/[workspaceId]/home/components/message-content/components/chat-content/external-link.tsx`) currently displays title, description, and site name in a tooltip but does not display the image. The component could be enhanced to show the image thumbnail in the preview tooltip if desired.
