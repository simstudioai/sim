import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { AlertCircle, AlertTriangle, Calendar, CheckCircle2, Clock, Terminal, Download } from 'lucide-react'
import { ConsoleEntry as ConsoleEntryType } from '@/stores/panel/console/types'
import { getBlock } from '@/blocks'
import { JSONView } from '../json-view/json-view'
import { formatDuration } from '@/lib/utils'

interface ConsoleEntryProps {
  entry: ConsoleEntryType
  consoleWidth: number
}

export function ConsoleEntry({ entry, consoleWidth }: ConsoleEntryProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const blockConfig = useMemo(() => {
    if (!entry.blockType) return null
    return getBlock(entry.blockType)
  }, [entry.blockType])

  const BlockIcon = blockConfig?.icon

  const statusIcon = entry.error ? (
    <AlertCircle className="h-4 w-4 text-destructive" />
  ) : entry.warning ? (
    <AlertTriangle className="h-4 w-4 text-warning" />
  ) : (
    <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
  )

  const formattedTime = useMemo(() => {
    const date = new Date(entry.timestamp)
    return date.toLocaleTimeString()
  }, [entry.timestamp])

  const handleDownload = async (imageUrl: string, model?: string) => {
    try {
      const response = await fetch('/api/download-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ imageUrl }),
      });

      if (!response.ok) throw new Error('Failed to download image');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const modelInfo = model ? `-${model}` : '';
      a.download = `dalle-image${modelInfo}-${timestamp}.png`;
      
      document.body.appendChild(a);
      a.click();
      
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading image:', error);
      window.open(imageUrl, '_blank');
    }
  };

  const renderImageWithDownload = (imageUrl: string, model?: string) => (
    <div className="relative group mt-2">
      <img 
        src={imageUrl} 
        alt="Generated image"
        className="max-w-full h-auto rounded-md shadow-sm"
        style={{ maxHeight: '300px' }}
      />
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleDownload(imageUrl, model);
        }}
        className="absolute top-2 right-2 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white transition-opacity opacity-0 group-hover:opacity-100"
        title="Download image"
      >
        <Download className="h-4 w-4" />
      </button>
    </div>
  );

  const enhanceOutputWithImage = (output: any) => {
    if (!output) return output;

    // Handle image generation output
    if (output.response?.content || output.imageUrl) {
      const imageUrl = output.response?.content || output.imageUrl;
      const model = output.response?.metadata?.model || output.metadata?.model;
      
      // Create a copy of the output to avoid mutating the original
      const enhancedOutput = { ...output };
      
      // Add the image component to the output
      enhancedOutput._imageComponent = renderImageWithDownload(imageUrl, model);
      
      return enhancedOutput;
    }

    return output;
  };

  return (
    <div
      className={`border-b border-border transition-colors ${
        !entry.error && !entry.warning ? 'hover:bg-accent/50 cursor-pointer' : ''
      }`}
      onClick={() => !entry.error && !entry.warning && setIsExpanded(!isExpanded)}
    >
      <div className="p-4 space-y-4">
        <div
          className={`${
            consoleWidth >= 400 ? 'flex items-center justify-between' : 'grid gap-4 grid-cols-1'
          }`}
        >
          {entry.blockName && (
            <div className="flex items-center gap-2 text-sm">
              {BlockIcon ? (
                <BlockIcon className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Terminal className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="text-muted-foreground">{entry.blockName}</span>
            </div>
          )}
          <div
            className={`${
              consoleWidth >= 400 ? 'flex gap-4' : 'grid grid-cols-2 gap-4'
            } text-sm text-muted-foreground`}
          >
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              <span>{formattedTime}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              <span>{formatDuration(entry.durationMs)}</span>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {!entry.error && !entry.warning && (
            <div className="flex items-start gap-2">
              <Terminal className="h-4 w-4 text-muted-foreground mt-1" />
              <div className="text-sm font-mono flex-1 break-normal whitespace-normal overflow-wrap-anywhere">
                <JSONView data={enhanceOutputWithImage(entry.output)} initiallyExpanded={isExpanded} />
              </div>
            </div>
          )}

          {entry.error && (
            <div className="flex items-start gap-2 border rounded-md p-3 border-red-500 bg-red-50 text-destructive dark:border-border dark:text-foreground dark:bg-background">
              <AlertCircle className="h-4 w-4 text-red-500 mt-1" />
              <div className="flex-1 break-normal whitespace-normal overflow-wrap-anywhere">
                <div className="font-medium">Error</div>
                <pre className="text-sm whitespace-pre-wrap">{entry.error}</pre>
              </div>
            </div>
          )}

          {entry.warning && (
            <div className="flex items-start gap-2 border rounded-md p-3 border-yellow-500 bg-yellow-50 text-yellow-700 dark:border-border dark:text-yellow-500 dark:bg-background">
              <AlertTriangle className="h-4 w-4 text-yellow-500 mt-1" />
              <div className="flex-1 break-normal whitespace-normal overflow-wrap-anywhere">
                <div className="font-medium">Warning</div>
                <pre className="text-sm whitespace-pre-wrap">{entry.warning}</pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
