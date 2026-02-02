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
    <div className="overflow-x-auto">
      <table className="min-w-full border border-primary-700 rounded-xl overflow-hidden">
        <thead className={`bg-primary-700 ${stickyHeader ? 'sticky top-0 z-10' : ''}`}>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={`px-6 py-4 text-sm font-semibold text-neutral-200 ${getAlignClass(column.align)}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-primary-700">
          {data.map((row, rowIndex) => {
            const isHighlighted = highlightRow ? highlightRow(row, rowIndex) : false;
            
            return (
              <tr
                key={rowIndex}
                className={`hover:bg-primary-700/50 transition-colors ${
                  isHighlighted ? 'bg-primary-700/30' : ''
                }`}
              >
                {columns.map((column, colIndex) => (
                  <td
                    key={`${rowIndex}-${column.key}`}
                    className={`px-6 py-4 ${getAlignClass(column.align)}`}
                  >
                    <div className="flex items-center gap-2 justify-end">
                      <span className="font-mono text-neutral-100">
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