import React from 'react';

interface SearchHighlightProps {
  text: string;
  searchQuery: string;
  className?: string;
}

// Sanitize search query to prevent any potential issues
const sanitizeSearchQuery = (query: string): string => {
  // Limit length to prevent excessive processing
  if (query.length > 100) {
    query = query.substring(0, 100);
  }
  
  // Remove any null bytes and control characters
  query = query.replace(/[\x00-\x1f\x7f]/g, '');
  
  return query.trim();
};

// Safe string-based highlighting without regex
const highlightText = (text: string, searchQuery: string): React.ReactNode[] => {
  const lowerText = text.toLowerCase();
  const lowerQuery = searchQuery.toLowerCase();
  const result: React.ReactNode[] = [];
  let lastIndex = 0;
  let matchIndex = 0;

  while (true) {
    const index = lowerText.indexOf(lowerQuery, lastIndex);
    if (index === -1) break;

    // Add text before match
    if (index > lastIndex) {
      result.push(text.substring(lastIndex, index));
    }

    // Add highlighted match
    result.push(
      <mark key={`match-${matchIndex++}`} className="bg-yellow-200 dark:bg-yellow-800">
        {text.substring(index, index + searchQuery.length)}
      </mark>
    );

    lastIndex = index + searchQuery.length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    result.push(text.substring(lastIndex));
  }

  return result;
};

export const SearchHighlight: React.FC<SearchHighlightProps> = ({ 
  text, 
  searchQuery, 
  className = '' 
}: SearchHighlightProps) => {
  // Return plain text if no search query
  if (!searchQuery || searchQuery.trim().length === 0) {
    return <span className={className}>{text}</span>;
  }

  // Sanitize the search query
  const sanitizedQuery = sanitizeSearchQuery(searchQuery);
  
  if (sanitizedQuery.length === 0) {
    return <span className={className}>{text}</span>;
  }

  try {
    // Use safe string-based highlighting
    const highlightedContent = highlightText(text, sanitizedQuery);
    
    if (highlightedContent.length === 0) {
      return <span className={className}>{text}</span>;
    }

    return (
      <span className={className}>
        {highlightedContent}
      </span>
    );
  } catch (error) {
    // Fallback to plain text if highlighting fails
    console.warn('SearchHighlight: Error during highlighting, falling back to plain text');
    return <span className={className}>{text}</span>;
  }
};
