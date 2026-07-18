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
    en: 'DASHBOARD',
    href: '/',
    icon: LayoutDashboard,
  },
  {
    title: 'ライブ入力',
    en: 'LIVE TIMING',
    href: '/live',
    icon: Timer,
  },
  {
    title: '計画',
    en: 'STRATEGY',
    href: '/plan',
    icon: ClipboardList,
  },
  {
    title: '設定',
    en: 'SETUP',
    href: '/settings',
    icon: Settings,
  },
];

export function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="bg-[#05070b] border-b border-border md:border-b-0 md:border-r md:w-60 md:min-h-screen shrink-0">
      {/* レーシングストライプ */}
      <div className="h-[3px] w-full bg-gradient-to-r from-primary via-primary/50 to-transparent" />

      <div className="p-4 md:p-5">
        <div className="mb-3 md:mb-10">
          <h1 className="font-display text-2xl font-bold tracking-[0.06em] leading-none text-foreground">
            MOTETAI<span className="text-primary">/</span>PIT
          </h1>
          <p className="hidden md:block mt-2 text-[10px] tracking-[0.32em] text-muted-foreground uppercase">
            Endurance Strategy
          </p>
        </div>

        <ul className="flex gap-1.5 overflow-x-auto md:flex-col md:overflow-visible">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <li key={item.href} className="shrink-0">
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2 md:py-2.5 border-l-2 rounded-sm text-sm font-medium transition-all whitespace-nowrap',
                    isActive
                      ? 'border-primary bg-primary/10 text-foreground shadow-[inset_0_0_24px_rgba(225,29,46,0.08)]'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/60',
                  )}
                >
                  <Icon className={cn('h-5 w-5', isActive && 'text-primary')} />
                  <span className="flex flex-col leading-tight">
                    <span>{item.title}</span>
                    <span
                      className={cn(
                        'hidden md:block text-[9px] tracking-[0.22em] uppercase',
                        isActive ? 'text-primary/80' : 'text-muted-foreground/60',
                      )}
                    >
                      {item.en}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
