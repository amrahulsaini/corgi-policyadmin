import { floorDiv, type Minor } from './money';

const DAY_MS = 86_400_000;

export type IsoDate = string;

export function parseDate(value: IsoDate): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) throw new Error(`not an ISO date: ${value}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function toDate(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function dayCount(from: IsoDate, to: IsoDate): number {
  return Math.round((parseDate(to) - parseDate(from)) / DAY_MS);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return toDate(parseDate(date) + days * DAY_MS);
}

export function anniversary(start: IsoDate): IsoDate {
  const [y, m, d] = start.split('-').map(Number);
  const target = Date.UTC(y + 1, m - 1, d);
  const back = new Date(target);
  if (back.getUTCMonth() !== m - 1) return toDate(Date.UTC(y + 1, m - 1 + 1, 1));
  return toDate(target);
}

export function clampDate(value: IsoDate, low: IsoDate, high: IsoDate): IsoDate {
  const v = parseDate(value);
  if (v < parseDate(low)) return low;
  if (v > parseDate(high)) return high;
  return value;
}

export type Layer = {
  startsOn: IsoDate;
  endsOn: IsoDate;
  amountMinor: Minor;
};

export function layerSpanDays(layer: Layer): number {
  const span = dayCount(layer.startsOn, layer.endsOn);
  if (span <= 0) throw new Error(`layer span must be positive: ${layer.startsOn}..${layer.endsOn}`);
  return span;
}

export function layerEarnedAsOf(layer: Layer, asOf: IsoDate): Minor {
  const span = layerSpanDays(layer);
  const elapsed = Math.min(Math.max(dayCount(layer.startsOn, asOf), 0), span);
  if (elapsed === 0) return 0n;
  if (elapsed === span) return layer.amountMinor;
  return floorDiv(layer.amountMinor * BigInt(elapsed), BigInt(span));
}

export function earnedAsOf(layers: Layer[], asOf: IsoDate): Minor {
  return layers.reduce((total, layer) => total + layerEarnedAsOf(layer, asOf), 0n);
}

export function writtenTotal(layers: Layer[]): Minor {
  return layers.reduce((total, layer) => total + layer.amountMinor, 0n);
}

export function unearnedAsOf(layers: Layer[], asOf: IsoDate): Minor {
  return writtenTotal(layers) - earnedAsOf(layers, asOf);
}

export function proRataDelta(
  annualDeltaMinor: Minor,
  effectiveDate: IsoDate,
  termStart: IsoDate,
  termEnd: IsoDate,
): Minor {
  const term = dayCount(termStart, termEnd);
  if (term <= 0) throw new Error('term must be positive');
  const effective = clampDate(effectiveDate, termStart, termEnd);
  const remaining = dayCount(effective, termEnd);
  if (remaining <= 0) return 0n;
  return floorDiv(annualDeltaMinor * BigInt(remaining), BigInt(term));
}

export function shortRateFactor(
  effectiveDate: IsoDate,
  termStart: IsoDate,
  termEnd: IsoDate,
  penaltyBps: number,
): { proRataMinorPerUnit: number; penaltyBps: number } {
  const term = dayCount(termStart, termEnd);
  const remaining = Math.max(dayCount(clampDate(effectiveDate, termStart, termEnd), termEnd), 0);
  return { proRataMinorPerUnit: remaining / term, penaltyBps };
}
