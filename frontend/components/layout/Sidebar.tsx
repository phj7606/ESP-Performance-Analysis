"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Upload, Home } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", icon: Home, label: "대시보드" },
  { href: "/upload", icon: Upload, label: "데이터 업로드" },
];

/**
 * 좌측 사이드바 네비게이션.
 * 현재 경로에 따라 활성 링크 강조 표시.
 */
export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-14 flex-shrink-0 bg-card border-r flex flex-col items-center py-4 gap-2">
      {/* 로고 */}
      <div className="mb-4">
        <Activity className="h-6 w-6 text-primary" />
      </div>

      {/* 네비게이션 링크 */}
      {navItems.map(({ href, icon: Icon, label }) => {
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
