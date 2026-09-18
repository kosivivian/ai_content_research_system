import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { ErrorRow } from "@/components/errors/error-row";
import type { ErrorLogEntry } from "@/lib/types/db";

export default async function ErrorsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "approver") {
    redirect("/dashboard");
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("error_logs")
    .select("*")
    .order("resolved", { ascending: true })
    .order("created_at", { ascending: false });

  const entries = (data ?? []) as ErrorLogEntry[];

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-semibold">Error log</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every pipeline failure across every request, oldest open ones first.
      </p>

      <div className="mt-6 flex flex-col gap-3">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No errors logged.</p>
        ) : (
          entries.map((entry) => <ErrorRow key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  );
}
