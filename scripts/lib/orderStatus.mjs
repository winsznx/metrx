/**
 * OrderStatus enum, mirrored from MetrxCore.sol.
 *
 * The Node scripts cannot import the TypeScript workspace package, so this is the single
 * place the mapping is written for them. Index order must match the Solidity enum exactly.
 */
export const ORDER_STATUS = [
  "None",
  "Funded",
  "Accepted",
  "Delivered",
  "Paid",
  "Refunded",
  "Slashed",
  "Cancelled",
];

export const statusName = (index) => ORDER_STATUS[Number(index)] ?? "None";
