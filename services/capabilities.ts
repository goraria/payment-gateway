/** Capabilities of these integrations, not a claim about every product offered by a provider. */
export function listProviderCapabilities() {
  return [
    {
      provider: "stripe",
      cancel: true,
      refund: true,
      partialRefund: true,
      automaticRefundQuery: true,
    },
    {
      provider: "momo",
      cancel: false,
      refund: true,
      partialRefund: true,
      automaticRefundQuery: true,
    },
    {
      provider: "zalopay",
      cancel: false,
      refund: true,
      partialRefund: true,
      automaticRefundQuery: true,
    },
    {
      provider: "vnpay",
      cancel: false,
      refund: true,
      partialRefund: true,
      automaticRefundQuery: false,
    },
  ];
}
