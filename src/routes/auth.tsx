import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in or create account — Sourcely" },
      { name: "description", content: "Access your Sourcely account to buy from verified global suppliers." },
      { property: "og:title", content: "Sign in — Sourcely" },
      { property: "og:description", content: "Access your Sourcely account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
  }, [navigate]);

  return (
    <AppShell>
      <div className="container mx-auto flex justify-center px-4 py-12">
        <Card className="w-full max-w-md p-6">
          <h1 className="mb-4 text-2xl font-semibold">Welcome to Sourcely</h1>
          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Sign up</TabsTrigger>
            </TabsList>
            <TabsContent value="signin"><SignInForm onDone={() => navigate({ to: "/" })} /></TabsContent>
            <TabsContent value="signup"><SignUpForm onDone={() => navigate({ to: "/" })} /></TabsContent>
          </Tabs>
        </Card>
      </div>
    </AppShell>
  );
}

function SignInForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Signed in");
    onDone();
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4">
      <div>
        <Label htmlFor="signin-email">Email</Label>
        <Input id="signin-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="signin-password">Password</Label>
        <Input id="signin-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</Button>
    </form>
  );
}

function SignUpForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { display_name: displayName },
      },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Account created");
    onDone();
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4">
      <div>
        <Label htmlFor="signup-name">Display name</Label>
        <Input id="signup-name" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="signup-email">Email</Label>
        <Input id="signup-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="signup-password">Password</Label>
        <Input id="signup-password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>{loading ? "Creating account…" : "Create account"}</Button>
    </form>
  );
}
