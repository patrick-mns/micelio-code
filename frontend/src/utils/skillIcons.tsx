import React from 'react';
import {
  Code2,
  Bug,
  FileText,
  Search,
  FileCode2,
  TestTube,
  Rocket,
  Palette,
  BookText,
  Zap,
  Shield,
  Database,
  Globe,
  GitBranch,
  Wrench,
  Puzzle,
} from 'lucide-react';

export type LucideIcon = React.ComponentType<{ size?: number; strokeWidth?: number }>;

/** Map a skill name (lowercased) to a Lucide icon component, or null */
export function skillIconForName(name: string): LucideIcon | null {
  const n = name.toLowerCase();

  if (n.includes('code') || n.includes('review')) return Code2;
  if (n.includes('bug') || n.includes('debug')) return Bug;
  if (n.includes('test')) return TestTube;
  if (n.includes('deploy') || n.includes('release')) return Rocket;
  if (n.includes('design') || n.includes('frontend') || n.includes('ui')) return Palette;
  if (n.includes('search') || n.includes('find')) return Search;
  if (n.includes('doc') || n.includes('readme')) return BookText;
  if (n.includes('perf') || n.includes('performance')) return Zap;
  if (n.includes('security') || n.includes('audit')) return Shield;
  if (n.includes('db') || n.includes('database') || n.includes('sql')) return Database;
  if (n.includes('api') || n.includes('backend')) return Globe;
  if (n.includes('git') || n.includes('pr') || n.includes('commit')) return GitBranch;
  if (n.includes('skill')) return Puzzle;
  if (n.includes('devops') || n.includes('ci') || n.includes('cd')) return Wrench;
  if (n.includes('script') || n.includes('terminal')) return FileCode2;
  if (n.includes('template') || n.includes('generate')) return FileText;

  return null;
}

/** Extract initials from a display name (e.g. "Code Review" → "CR") */
export function skillInitials(displayName: string): string {
  return displayName
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 3);
}
