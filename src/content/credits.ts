/**
 * Creator credit + donation target for the cyberdeck menu.
 *
 * qrImage is the X Money QR (public/QRCodeX.png) that opens the send-money flow.
 * donateUrl is the clickable profile fallback when someone taps the QR / link.
 */
export const CREDITS = {
  handle: '@RichGarrick',
  displayName: 'Rich Garrick',
  profileUrl: 'https://x.com/RichGarrick',
  /** Profile / tip entry when the QR isn't scanned */
  donateUrl: 'https://x.com/RichGarrick',
  /** Official X Money QR asset */
  qrImage: '/QRCodeX.png',
  blurb:
    'If you enjoy the breach, a tip via X Money keeps the solar deck online. Off-grid Alaska · Starlink · pure NL + Grok Build.',
} as const;
