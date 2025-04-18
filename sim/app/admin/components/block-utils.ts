export const formatBlockName = (name: string | undefined | null): string => {
  // Handle undefined or null values
  if (!name) return 'Unknown Block'
  
  // Remove underscores and convert to title case
  return name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
    .replace(/([0-9]+)/, ' $1') // Add space before numbers
} 