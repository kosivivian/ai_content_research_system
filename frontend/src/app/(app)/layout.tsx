import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { Sidebar } from "@/components/layout/sidebar";
import { SignOutButton } from "@/components/layout/sign-out-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();

  // Middleware redirects signed-out visitors before this renders; this
  // covers the edge case of a session cookie whose user row is gone.
  if (!profile) {
    redirect("/login");
  }

  if (!profile.active) {
    redirect("/deactivated");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card">
        <div className="border-b border-border px-4 py-4">
          <p className="text-sm font-semibold">Content Agent</p>
          <p className="text-xs text-muted-foreground capitalize">{profile.role}</p>
        </div>
        <div className="flex-1">
          <Sidebar role={profile.role} />
        </div>
        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <span className="truncate text-xs text-muted-foreground">{profile.email}</span>
          <SignOutButton />
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-muted/40">{children}</main>
    </div>
  );
}
