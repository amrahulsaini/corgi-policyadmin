'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const TRIES = 10;

export default function Poll() {
  const router = useRouter();
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (tries >= TRIES) return;
    const timer = setTimeout(() => {
      setTries((n) => n + 1);
      router.refresh();
    }, 3000);
    return () => clearTimeout(timer);
  }, [tries, router]);

  if (tries >= TRIES) {
    return (
      <p className="text-xs text-[var(--warn)] bg-[var(--warn-soft)] rounded-md px-3 py-2 text-center">
        The webhook has not arrived after {TRIES * 3} seconds. Reload, or check the delivery log at
        the provider — the receivable stays open until it lands, which is the safe direction.
      </p>
    );
  }

  return (
    <p className="text-xs text-[var(--ink-faint)] text-center">
      Checking for the webhook… {tries + 1} of {TRIES}
    </p>
  );
}
