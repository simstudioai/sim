export function avatarInitials(name: string, count = 2) {
  return name
    .trim()
    .split(/\s+/u)
    .slice(0, count)
    .map((word) => Array.from(word)[0])
    .join('')
    .toUpperCase()
}
