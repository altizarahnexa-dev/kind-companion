/** Presentation-only formatting helpers. Currency-safe. */
export function formatMoney(amountMinor: number, currency: string, minorUnit = 2): string {
  const major = amountMinor / Math.pow(10, minorUnit);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(major);
  } catch {
    return `${major.toFixed(minorUnit)} ${currency}`;
  }
}
