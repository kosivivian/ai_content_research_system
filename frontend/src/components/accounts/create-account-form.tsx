"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { ProfileRole } from "@/lib/types/db";

export function CreateAccountForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ProfileRole>("creator");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; tempPassword: string } | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setCreated(null);
    try {
      const res = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create account.");

      setCreated({ email: json.email, tempPassword: json.tempPassword });
      setEmail("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-account-email">Email</Label>
          <Input
            id="new-account-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-64"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-account-role">Role</Label>
          <select
            id="new-account-role"
            value={role}
            onChange={(e) => setRole(e.target.value as ProfileRole)}
            className="h-10 rounded-md border border-input bg-card px-3 text-sm"
          >
            <option value="creator">Creator</option>
            <option value="approver">Approver</option>
          </select>
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating..." : "Create account"}
        </Button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {created && (
        <p className="rounded-md bg-accent p-3 text-sm text-accent-foreground">
          Created <strong>{created.email}</strong>. Temporary password: <code>{created.tempPassword}</code> --
          share this with them directly; it won&apos;t be shown again.
        </p>
      )}
    </form>
  );
}
