"use client";

import { useState } from "react";

type ToolCallRendererProps = {
  name: string;
  args: any;
  status: string;
  result: any;
};

export const ToolCallRenderer: React.FC<ToolCallRendererProps> = ({
  name,
  args,
  status,
  result,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  // Format JSON objects for display
  const formatJSON = (obj: any) => {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  };

  // Status color mapping
  const statusColors: Record<string, string> = {
    running: "bg-yellow-500/20 text-yellow-300",
    success: "bg-green-500/20 text-green-300",
    error: "bg-red-500/20 text-red-300",
    pending: "bg-blue-500/20 text-blue-300",
    unknown: "bg-gray-500/20 text-gray-300",
  };

  const statusColor = statusColors[status.toLowerCase()] || "bg-gray-700/20 text-gray-300";

  return (
    <div className="my-2 rounded-lg border border-gray-800 overflow-hidden shadow-sm bg-black">
      {/* Header - always visible */}
      <div 
        className="flex items-center justify-between p-3 bg-zinc-900 cursor-pointer hover:bg-zinc-800 transition-colors relative overflow-hidden tool-container-shine"
        onClick={toggleExpand}
      >
        <div className="flex items-center space-x-2">
          {/* Tool icon */}
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            width="18" 
            height="18" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="2" 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            className="text-gray-400"
          >
            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
            <path d="M7 10h3v-3l-3.5 -3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1 -3 3l-6 -6a6 6 0 0 1 -8 -8l3.5 3.5" />
          </svg>
          
          {/* Tool name without animation */}
          <div className="tracking-tight text-gray-400">
            {name}
          </div>
        </div>
      </div>

      {/* Details - visible when expanded */}
      {isExpanded && (
        <div className="p-3">
          {/* Arguments Section */}
          <div className="mb-3">
            {/* <div className="text-sm font-medium text-gray-400 mb-1">Arguments:</div> */}
            <div className="bg-gradient-to-br from-zinc-900 to-zinc-950 text-white font-mono p-4 rounded-xl overflow-x-auto shadow-lg border border-zinc-800/50">
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2 mb-3">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-500/80 shadow-lg shadow-red-500/20"></span>
                    <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/80 shadow-lg shadow-yellow-500/20"></span>
                    <span className="h-2.5 w-2.5 rounded-full bg-green-500/80 shadow-lg shadow-green-500/20"></span>
                  </div>
                  <span className="text-zinc-400 text-xs font-medium ml-2">sim@tool</span>
                </div>
                <span className="px-2 py-0.5 text-[10px] font-medium bg-zinc-800/50 rounded-full text-zinc-400 uppercase tracking-wider">
                  args
                </span>
              </div>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-teal-500/90">❯</span>
                    <span className="text-zinc-400 text-sm">Data</span>
                  </div>
                  <pre className="text-emerald-300/90 text-sm pl-4 whitespace-pre-wrap overflow-x-auto">
                    {formatJSON(args)}
                  </pre>
                </div>
              </div>
            </div>
          </div>

          {/* Result Section - shown only if there's a result */}
          {result && (
            <div>
              <div className="text-sm font-medium text-gray-400 mb-1">Result:</div>
              <div className="bg-gradient-to-br from-zinc-900 to-zinc-950 text-white font-mono p-4 rounded-xl overflow-x-auto shadow-lg border border-zinc-800/50">
                <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2 mb-3">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-red-500/80 shadow-lg shadow-red-500/20"></span>
                      <span className="h-2.5 w-2.5 rounded-full bg-yellow-500/80 shadow-lg shadow-yellow-500/20"></span>
                      <span className="h-2.5 w-2.5 rounded-full bg-green-500/80 shadow-lg shadow-green-500/20"></span>
                    </div>
                    <span className="text-zinc-400 text-xs font-medium ml-2">sim@tool</span>
                  </div>
                  <span className="px-2 py-0.5 text-[10px] font-medium bg-zinc-800/50 rounded-full text-zinc-400 uppercase tracking-wider">
                    result
                  </span>
                </div>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-teal-500/90">❯</span>
                      <span className="text-zinc-400 text-sm">Data</span>
                    </div>
                    <pre className="text-emerald-300/90 text-sm pl-4 whitespace-pre-wrap overflow-x-auto">
                      {formatJSON(result)}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};