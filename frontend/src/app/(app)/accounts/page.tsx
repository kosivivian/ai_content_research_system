import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateAccountForm } from "@/components/accounts/create-account-form";
import { AccountRow } from "@/components/accounts/account-row";
import type { Profile } from "@/lib/types/db";

export default async function AccountsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "approver") {
    redirect("/dashboard");
  }

  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").order("created_at", { ascending: true });
  const accounts = (data ?? []) as Profile[];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold">Accounts</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Only approvers can create accounts or deactivate/reactivate them.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Create an account</CardTitle>
          <CardDescription>
            They sign in with the temporary password shown after creation -- share it with them directly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateAccountForm />
        </CardContent>
      </Card>

      <div className="mt-6 flex flex-col gap-2">
        {accounts.map((account) => (
          <AccountRow key={account.id} account={account} isSelf={account.id === profile.id} />
        ))}
      </div>
    </div>
  );
}
