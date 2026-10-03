/**
 * Money adapter: handles converting canonical *_minor integers and currency ISO to presentation strings.
 * Note: Never recalculates totals in the frontend. Backend is authoritative.
 */

export function formatMinorToDisplay(amountMinor: number, currency = 'USD'): string {
  const units = amountMinor / 100;
  return new Intl.NumberFormat('es-EC', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(units);
}

export function minorToDecimal(amountMinor: number): number {
  return amountMinor / 100;
}

export function decimalToMinor(decimalAmount: number): number {
  return Math.round(decimalAmount * 100);
}
