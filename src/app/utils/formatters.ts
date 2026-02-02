// Completado basado en el truncado del documento
export const formatCurrency = (value: number, locale = 'es-AR'): string => {
  if (isNaN(value)) return 'N/A';
  return value.toLocaleString(locale, { style: 'currency', currency: 'USD' });
};

export const formatPercentage = (value: number): string => {
  if (isNaN(value)) return 'N/A';
  return `${value.toFixed(2)}%`;
};

export const formatNumber = (value: number, digits = 2): string => {
  if (isNaN(value)) return 'N/A';
  return value.toLocaleString('es-AR', { maximumFractionDigits: digits });
};

export const formatLargeNumber = (value: number): string => {
  if (isNaN(value)) return 'N/A';
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return formatCurrency(value);
};