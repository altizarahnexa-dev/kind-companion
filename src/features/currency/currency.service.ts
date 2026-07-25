import { supabase } from "@/integrations/supabase/client";

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  minorUnit: number;
  rateToUsd: number;
}

export const currencyService = {
  async list(): Promise<Currency[]> {
    const { data, error } = await supabase
      .from("currencies")
      .select("code, name, symbol, minor_unit, rate_to_usd")
      .order("code");
    if (error) throw error;
    return (data ?? []).map((c: any) => ({
      code: c.code, name: c.name, symbol: c.symbol,
      minorUnit: c.minor_unit, rateToUsd: Number(c.rate_to_usd),
    }));
  },

  format(amountMinor: number, currency: Currency): string {
    const major = amountMinor / Math.pow(10, currency.minorUnit);
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.code }).format(major);
    } catch {
      return `${currency.symbol}${major.toFixed(currency.minorUnit)}`;
    }
  },

  convert(amountMinor: number, from: Currency, to: Currency): number {
    if (from.code === to.code) return amountMinor;
    const usd = amountMinor / from.rateToUsd;
    return Math.round(usd * to.rateToUsd);
  },
};
