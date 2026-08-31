export type Minor = bigint;

export const ZERO: Minor = 0n;

export function minor(dollars: string | number): Minor {
  const text = typeof dollars === 'number' ? dollars.toFixed(2) : dollars.trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error(`not a money amount: ${text}`);
  const [, sign, whole, frac = ''] = match;
  const cents = BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
  return sign === '-' ? -cents : cents;
}

export function format(value: Minor): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}$${grouped}.${frac}`;
}

export function abs(value: Minor): Minor {
  return value < 0n ? -value : value;
}

export function floorDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('division by zero');
  const q = numerator / denominator;
  const r = numerator % denominator;
  return r !== 0n && (r < 0n) !== (denominator < 0n) ? q - 1n : q;
}

export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('division by zero');
  const q = numerator / denominator;
  const r = numerator % denominator;
  return r !== 0n && (r < 0n) === (denominator < 0n) ? q + 1n : q;
}

export function rateOf(base: Minor, bps: number): Minor {
  return floorDiv(base * BigInt(bps), 10_000n);
}

export function allocate(total: Minor, weights: bigint[]): Minor[] {
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n) throw new Error('cannot allocate across zero weight');
  const base = weights.map((w) => floorDiv(total * w, sum));
  let residual = total - base.reduce((a, b) => a + b, 0n);
  const order = weights
    .map((w, i) => ({ i, remainder: (total * w) % sum }))
    .sort((a, b) => (a.remainder === b.remainder ? a.i - b.i : b.remainder > a.remainder ? 1 : -1));
  let k = 0;
  const step = residual < 0n ? -1n : 1n;
  while (residual !== 0n) {
    base[order[k % order.length].i] += step;
    residual -= step;
    k += 1;
  }
  return base;
}
