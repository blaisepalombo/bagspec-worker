// eBay sellers commonly auto-decline offers well below the asking price,
// and low offers annoy them. BagSpec only suggests offers of at least this
// share of the asking price, and opens there.
export const OFFER_FLOOR_SHARE = 0.85;

// The first offer to send: the floor, rounded up to a whole dollar, but
// never above the most BagSpec would pay.
export function openingOffer(askingPrice, maxOffer = Infinity) {
  const floor = Math.ceil(Number(askingPrice || 0) * OFFER_FLOOR_SHARE);
  return Math.min(floor, Number(maxOffer));
}

// "$128-$140" when there's room between the opener and the max, else "$140".
export function offerRange(askingPrice, maxOffer, digits = 0) {
  const open = openingOffer(askingPrice, maxOffer);
  const max = Number(maxOffer || 0);
  return open < max ? `$${open.toFixed(0)}–$${max.toFixed(digits)}` : `$${max.toFixed(digits)}`;
}
