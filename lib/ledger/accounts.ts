export const ACCOUNT = {
  cash: '1000',
  premiumReceivable: '1100',
  claimClearing: '1200',
  unearnedPremium: '2000',
  surplusLinesTax: '2100',
  stampingFee: '2110',
  commissionPayable: '2200',
  claimReserve: '2300',
  refundPayable: '2400',
  earnedPremium: '4000',
  policyFeeIncome: '4100',
  commissionExpense: '5000',
  claimExpense: '5100',
  processorFees: '5200',
  rounding: '5900',
} as const;

export type AccountCode = (typeof ACCOUNT)[keyof typeof ACCOUNT];
