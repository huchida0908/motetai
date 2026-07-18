'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  ClipboardList,
  LayoutDashboard,
  Settings,
  Timer
} from 'lucide-react';

const navigationItems = [
  {
    title: 'ダッシュボード',
    href: '/',
    icon: LayoutDashboard,
  },
  {
    title: 'ライブ入力',
    href: '/live',
    icon: Timer,
  },
  {
    title: '計画',
    href: '/plan',
    icon: ClipboardList,
  },
  {
    title: '設定',
    href: '/settings',
    icon: Settings,
  },
];

export function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="bg-card border-b border-border p-4 md:border-b-0 md:border-r md:w-64 md:min-h-screen md:p-6">
      <div className="mb-3 md:mb-8">
        <h1 className="text-lg md:text-xl font-bold text-foreground">耐久レース戦略</h1>
        <p className="hidden md:block text-sm text-muted-foreground">戦略支援ツール</p>
      </div>

      <ul className="flex gap-2 overflow-x-auto md:flex-col md:overflow-visible">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                )}
              >
                <Icon className="h-5 w-5" />
                <span>{item.title}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
} 