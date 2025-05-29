'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { 
  LayoutDashboard, 
  Users, 
  Fuel, 
  Route, 
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
    title: 'ライダー管理',
    href: '/riders',
    icon: Users,
  },
  {
    title: '燃料タイプ',
    href: '/fuel-types',
    icon: Fuel,
  },
  {
    title: '区間エディタ',
    href: '/segments',
    icon: Route,
  },
  {
    title: 'リアルタイム',
    href: '/realtime',
    icon: Timer,
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
    <nav className="w-64 bg-card border-r border-border p-6">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-foreground">
          耐久レース戦略
        </h1>
        <p className="text-sm text-muted-foreground">
          戦略支援ツール
        </p>
      </div>
      
      <ul className="space-y-2">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  'flex items-center space-x-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
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