/**
 * Appends an image to a note's markdown as its own block.
 *
 * The blank line is what makes it a block rather than part of the preceding
 * paragraph, and trimming the tail first keeps a note that already ends in blank
 * lines from growing a run of them with every image.
 */
export function appendNoteImageMarkdown(
  content: string,
  image: { url: string; alt: string }
): string {
  const body = content.trimEnd()
  return `${body ? `${body}\n\n` : ''}![${image.alt}](${image.url})`
}
