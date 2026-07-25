import { supabase } from "@/integrations/supabase/client";

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  totalMinor: number;
  currency: string;
  createdAt: string;
  itemCount: number;
}

export const orderService = {
  async listMine(): Promise<OrderSummary[]> {
    const { data, error } = await supabase
      .from("orders")
      .select("id, order_number, status, total_minor, currency_code, created_at, order_items(id)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((o: any) => ({
      id: o.id,
      orderNumber: o.order_number,
      status: o.status,
      totalMinor: Number(o.total_minor),
      currency: o.currency_code,
      createdAt: o.created_at,
      itemCount: (o.order_items ?? []).length,
    }));
  },

  async get(id: string) {
    const { data, error } = await supabase
      .from("orders")
      .select("*, order_items(*)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
};
