'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Nav({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-0.5 overflow-x-auto">
      {items.map((item) => {
        const active =
          pathname === item.href ||
          (item.href !== '/staff' && item.href !== '/broker' && pathname.startsWith(`${item.href}/`));

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`px-2.5 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors ${
              active
                ? 'text-[var(--ink)] bg-[var(--line-soft)] font-medium'
                : 'text-[var(--ink-soft)] hover:text-[var(--ink)] hover:bg-[var(--line-soft)]'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
