"use client";

/**
 * Left sidebar navigation
 *
 * Icon-based narrow sidebar (w-14).
 * Highlights the active link based on the current route.
 *
 * Navigation items:
 * - Dashboard (Well list)
 * - Data Upload
 * - Step 4 Comprehensive Analysis (run after all wells are complete)
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Upload, Home } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", icon: Home, label: "Dashboard" },
  { href: "/upload", icon: Upload, label: "Data Upload" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-14 flex-shrink-0 bg-card border-r flex flex-col items-center py-4 gap-2">
      {/* Logo */}
      <div className="mb-4">
        <Activity className="h-6 w-6 text-primary" />
      </div>

      {/* Navigation links */}
      {navItems.map(({ href, icon: Icon, label }) => {
        // Dashboard activates only for the exact "/" path (excludes wells/, upload/, etc.)
        // Other items use startsWith to include sub-routes
        const isActive =
          href === "/" ? pathname === "/" : pathname.startsWith(href);

        return (
          <Link
            key={href}
            href={href}
            title={label}
            className={cn(
              "flex items-center justify-center w-9 h-9 rounded-md transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="sr-only">{label}</span>
          </Link>
        );
      })}
    </aside>
  );
}
