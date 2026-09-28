// PRO pricing: $10 for the first offer, +$8 per additional offer (1 offer = $10,
// 2 offers = $18, 3 offers = $26, ...). Billing is monthly.
export const PRO_BASE_PRICE = 10; // USD / month, first offer
export const PRO_ADDITIONAL_PRICE = 8; // USD / month, each extra offer

export function getProPriceForOfferCount(count) {
  const n = Math.max(1, Math.floor(Number(count) || 0));
  return PRO_BASE_PRICE + (n - 1) * PRO_ADDITIONAL_PRICE;
}

export function getProSavings(count) {
  const n = Math.max(1, Math.floor(Number(count) || 0));
  // Without the bundle discount every offer would cost the full first-offer price.
  return n * PRO_BASE_PRICE - getProPriceForOfferCount(n);
}