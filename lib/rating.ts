import { floorDiv, minor, type Minor } from './money';

export type Exposure =
  | { kind: 'vehicle'; description: string; vin: string; garageState: string }
  | { kind: 'location'; description: string; squareFeet: number; state: string };

export type RatingInput = {
  productCode: string;
  stateCode: string;
  limitMinor: Minor;
  deductibleMinor: Minor;
  exposures: Exposure[];
};

export type RatingComponent = {
  label: string;
  amountMinor: Minor;
  basis: string;
};

export type Rating = {
  annualPremiumMinor: Minor;
  components: RatingComponent[];
};

const BASE_MINOR = minor('1800.00');
const RATE_PER_1000_LIMIT_BPS = 42;
const PER_VEHICLE_MINOR = minor('640.00');
const PER_1000_SQFT_MINOR = minor('95.00');
const MINIMUM_PREMIUM_MINOR = minor('2500.00');

const STATE_FACTOR_BPS: Record<string, number> = {
  CA: 11_800,
  TX: 10_400,
  NY: 12_500,
};

const DEDUCTIBLE_CREDIT_BPS: Record<string, number> = {
  '100000': 0,
  '250000': 400,
  '500000': 900,
  '1000000': 1500,
};

export function rate(input: RatingInput): Rating {
  const components: RatingComponent[] = [];

  components.push({
    label: 'Base premium',
    amountMinor: BASE_MINOR,
    basis: `${input.productCode} minimum exposure charge`,
  });

  const limitThousands = floorDiv(input.limitMinor, 100_000n);
  const limitCharge = floorDiv(limitThousands * BigInt(RATE_PER_1000_LIMIT_BPS) * 100n, 100n);
  components.push({
    label: 'Limit charge',
    amountMinor: limitCharge,
    basis: `${limitThousands} thousand of limit at ${RATE_PER_1000_LIMIT_BPS} bps`,
  });

  const vehicles = input.exposures.filter((e) => e.kind === 'vehicle').length;
  if (vehicles > 0) {
    components.push({
      label: 'Scheduled vehicles',
      amountMinor: PER_VEHICLE_MINOR * BigInt(vehicles),
      basis: `${vehicles} vehicle(s) at ${PER_VEHICLE_MINOR / 100n} each`,
    });
  }

  const sqft = input.exposures
    .filter((e): e is Extract<Exposure, { kind: 'location' }> => e.kind === 'location')
    .reduce((total, e) => total + e.squareFeet, 0);
  if (sqft > 0) {
    const charge = floorDiv(PER_1000_SQFT_MINOR * BigInt(sqft), 1000n);
    components.push({
      label: 'Scheduled locations',
      amountMinor: charge,
      basis: `${sqft} sq ft at ${PER_1000_SQFT_MINOR / 100n} per 1,000`,
    });
  }

  const subtotal = components.reduce((total, c) => total + c.amountMinor, 0n);

  const deductibleBps = DEDUCTIBLE_CREDIT_BPS[(input.deductibleMinor / 100n).toString()] ?? 0;
  if (deductibleBps > 0) {
    const credit = -floorDiv(subtotal * BigInt(deductibleBps), 10_000n);
    components.push({
      label: 'Deductible credit',
      amountMinor: credit,
      basis: `${deductibleBps / 100}% for a ${input.deductibleMinor / 100n} deductible`,
    });
  }

  const afterCredit = components.reduce((total, c) => total + c.amountMinor, 0n);

  const stateBps = STATE_FACTOR_BPS[input.stateCode];
  if (stateBps === undefined) {
    throw new Error(`no filed rate for state ${input.stateCode}`);
  }
  const stateAdjust = floorDiv(afterCredit * BigInt(stateBps), 10_000n) - afterCredit;
  components.push({
    label: 'State factor',
    amountMinor: stateAdjust,
    basis: `${input.stateCode} filed factor ${stateBps / 10_000}`,
  });

  let annual = components.reduce((total, c) => total + c.amountMinor, 0n);

  if (annual < MINIMUM_PREMIUM_MINOR) {
    const bump = MINIMUM_PREMIUM_MINOR - annual;
    components.push({
      label: 'Minimum premium adjustment',
      amountMinor: bump,
      basis: `brought up to the ${MINIMUM_PREMIUM_MINOR / 100n} filed minimum`,
    });
    annual = MINIMUM_PREMIUM_MINOR;
  }

  return { annualPremiumMinor: annual, components };
}
