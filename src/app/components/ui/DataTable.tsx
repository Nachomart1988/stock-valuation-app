import React from 'react';
import { TrendIndicator } from './TrendIndicator';

interface Column {
  key: string;
  label: string;
  format?: 'currency' | 'percentage' | 'number' | 'date';
  align?: 'left' | 'center' | 'right';
}

interface DataTableProps {
  columns: Column[];
  data: any[];
  showTrends?: boolean;
  stickyHeader?: boolean;
  highlightRow?: (row: any, index: number) => boolean;
}

export function DataTable({ 
  columns, 
  data, 
  showTrends = false,
  stickyHeader = false,
  highlightRow
}: DataTableProps) {
  const formatValue = (value: any, format?: string) => {
    if (value === null || value === undefined) return 'N/A';
    
    const numValue = typeof value === 'number' ? value : parseFloat(value);
    
    if (isNaN(numValue)) return value;
    
    switch (format) {
      case 'currency':
        if (numValue >= 1e9) return `$${(numValue / 1e9).toFixed(2)}B`;
        if (numValue >= 1e6) return `$${(numValue / 1e6).toFixed(2)}M`;
        return `$${numValue.toLocaleString('es-AR')}`;
      
      case 'percentage':
        return `${numValue.toFixed(2)}%`;
      
      case 'date':
        return new Date(value).toLocaleDateString('es-AR');
      
      default:
        return numValue.toLocaleString('es-AR', { maximumFractionDigits: 2 });
    }
  };

  const getAlignClass = (align?: string) => {
    switch (align) {
      case 'center': return 'text-center';
      case 'right': return 'text-right';
      default: return 'text-left';
    }
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-green-900/20">
      <table className="min-w-full">
        <thead className={`bg-black/60 backdrop-blur-sm ${stickyHeader ? 'sticky top-0 z-10' : ''}`}>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={`px-6 py-4 text-sm font-semibold text-green-400/80 border-b border-green-900/20 ${getAlignClass(column.align)}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-green-900/10">
          {data.map((row, rowIndex) => {
            const isHighlighted = highlightRow ? highlightRow(row, rowIndex) : false;

            return (
              <tr
                key={rowIndex}
                className={`hover:bg-green-900/10 transition-colors ${
                  isHighlighted ? 'bg-green-900/5' : ''
                }`}
              >
                {columns.map((column, colIndex) => (
                  <td
                    key={`${rowIndex}-${column.key}`}
                    className={`px-6 py-4 ${getAlignClass(column.align)}`}
                  >
                    <div className="flex items-center gap-2 justify-end">
                      <span className="font-data text-neutral-100">
                        {formatValue(row[column.key], column.format)}
                      </span>
                      {showTrends && colIndex > 0 && rowIndex < data.length - 1 && (
                        <TrendIndicator
                          trend={row[column.key] > data[rowIndex + 1][column.key] ? 'up' : 'down'}
                          showPercentage={false}
                        />
                      )}
                    </div>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}