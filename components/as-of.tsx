'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function AsOfPicker({
  basePath,
  policyId,
  asOf,
  termStart,
  termEnd,
}: {
  basePath: string;
  policyId: string;
  asOf: string;
  termStart: string;
  termEnd: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(asOf);

  function go(next: string) {
    setValue(next);
    router.push(`${basePath}/${policyId}?asOf=${next}`);
  }

  return (
    <div className="card p-4 flex flex-wrap items-end gap-4">
      <div>
        <label htmlFor="asOf" className="block text-xs font-semibold mb-1.5">
          Show the policy as it stood on
        </label>
        <input
          id="asOf"
          type="date"
          value={value}
          min={termStart}
          max={termEnd}
          onChange={(e) => go(e.target.value)}
          className="field num w-48"
        />
      </div>

      <div className="flex gap-2">
        <button type="button" className="btn btn-ghost text-xs" onClick={() => go(termStart)}>
          Inception
        </button>
        <button
          type="button"
          className="btn btn-ghost text-xs"
          onClick={() => go(new Date().toISOString().slice(0, 10))}
        >
          Today
        </button>
        <button type="button" className="btn btn-ghost text-xs" onClick={() => go(termEnd)}>
          Expiry
        </button>
      </div>

      <p className="text-xs text-[var(--ink-soft)] max-w-md">
        Earned premium, limits and exposures are recomputed for that date from the entries alone. No
        snapshot is stored.
      </p>
    </div>
  );
}
