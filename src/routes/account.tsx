import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { currencyService } from "@/features/currency/currency.service";

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [
      { title: "Account — Sourcely" },
      { name: "description", content: "Manage your Sourcely profile and preferences." },
      { property: "og:title", content: "Account — Sourcely" },
      { property: "og:description", content: "Manage your Sourcely profile and preferences." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AccountPage,
});

function AccountPage() {
  const { user, isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate({ to: "/auth" });
  }, [loading, isAuthenticated, navigate]);

  const profile = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", user!.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const currencies = useQuery({
    queryKey: ["currencies"],
    queryFn: () => currencyService.list(),
  });

  const [displayName, setDisplayName] = useState("");
  const [currency, setCurrency] = useState("USD");

  useEffect(() => {
    if (profile.data) {
      setDisplayName(profile.data.display_name ?? "");
      setCurrency(profile.data.preferred_currency ?? "USD");
    }
  }, [profile.data]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: displayName, preferred_currency: currency })
        .eq("id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["profile"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  if (!user) return null;

  return (
    <AppShell>
      <div className="container mx-auto max-w-2xl px-4 py-6">
        <h1 className="mb-6 text-2xl font-semibold">Account</h1>
        <Card className="p-6">
          <div className="space-y-4">
            <div>
              <Label>Email</Label>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
            <div>
              <Label htmlFor="dn">Display name</Label>
              <Input id="dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="cur">Preferred currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="cur"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {currencies.data?.map((c) => (
                    <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </Card>

        <div className="mt-6 flex gap-3">
          <Button asChild variant="outline"><Link to="/orders">My orders</Link></Button>
          <Button asChild variant="outline"><Link to="/wishlist">My wishlist</Link></Button>
        </div>
      </div>
    </AppShell>
  );
}
