'use client';

import React from 'react';

/**
 * Renders narrative text converting **bold** markdown to <strong> tags.
 * Preserves line breaks via whitespace-pre-line.
 */
export function NarrativeText({ text, className }: { text: string; className?: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <div className={className}>
      {parts.map((part, i) =>
        i % 2 === 1
          ? <strong key={i} className="text-white font-semibold">{part}</strong>
          : <React.Fragment key={i}>{part}</React.Fragment>
      )}
    </div>
  );
}
