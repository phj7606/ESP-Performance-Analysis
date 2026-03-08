"use client";

/**
 * Analysis Status Badge Component
 *
 * Displays a well's analysis_status as a human-readable, color-coded badge.
 * Consolidates the StatusBadge that was previously defined inline in page.tsx files.
 */

import { Badge } from "@/components/ui/badge";
import { getStatusLabel, getStatusVariant } from "@/lib/workflow";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

/**
 * Renders the analysis status as a color-coded badge.
 * Uses getStatusLabel/getStatusVariant utilities from workflow.ts
 * to centralise all status-related logic in one place.
 */
export function StatusBadge({ status, className }: StatusBadgeProps) {
  const label = getStatusLabel(status);
  const variant = getStatusVariant(status);

  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}
