'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  FolderKanban,
  Settings,
  History,
  FileText,
  Sun,
  Moon,
  Bug,
  BookOpen,
} from 'lucide-react';

const navigation = [
  { name: 'Activity', href: '/jobs', icon: History },
  { name: 'Projects', href: '/projects', icon: FolderKanban },
  { name: 'Logs', href: '/logs', icon: FileText },
  { name: 'Docs', href: '/docs', icon: BookOpen },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export function Header() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Prevent hydration mismatch by only rendering theme-dependent UI after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto max-w-7xl px-6 flex h-14 items-center">
        {/* Logo */}
        <Link href="/jobs" className="mr-6 flex items-center space-x-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Bug className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="hidden font-bold sm:inline-block">Discharge</span>
        </Link>

        {/* Navigation */}
        <nav className="flex items-center space-x-6 text-sm font-medium">
          {navigation.map((item) => {
            const isActive = pathname?.startsWith(item.href) ?? false;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-2 transition-colors hover:text-foreground/80',
                  isActive ? 'text-foreground' : 'text-foreground/60'
                )}
              >
                <item.icon className="h-4 w-4" />
                <span className="hidden sm:inline-block">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Theme Toggle - only render after mount to avoid hydration mismatch */}
        {mounted ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="h-9 w-9"
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">Toggle theme</span>
          </Button>
        ) : (
          <div className="h-9 w-9" /> // Placeholder to prevent layout shift
        )}
      </div>
    </header>
  );
}
