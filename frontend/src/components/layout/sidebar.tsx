"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { ProfileRole } from "@/lib/types/db";
import { LayoutDashboard, FilePlus2, Users, AlertTriangle } from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}

const CREATOR_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/requests/new", label: "New request", icon: FilePlus2 },
];

const APPROVER_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/accounts", label: "Accounts", icon: Users },
  { href: "/errors", label: "Error log", icon: AlertTriangle },
];

export function Sidebar({ role }: { role: ProfileRole }) {
  const pathname = usePathname();
  const items = role === "approver" ? APPROVER_NAV : CREATOR_NAV;

  return (
    <nav className="flex flex-col gap-1 p-4">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
