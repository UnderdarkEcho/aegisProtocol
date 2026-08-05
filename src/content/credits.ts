/**
 * Creator credit + donation target for the cyberdeck menu.
 *
 * donateUrl is what the QR encodes. Default is the X profile so people can
 * tip / pay via X Money. If you get a dedicated pay/receive link from X Money,
 * paste it here and regenerate public/donate-qr.png:
 *
 *   npx qrcode -o public/donate-qr.png -w 220 "YOUR_URL_HERE"
 */
export const CREDITS = {
  handle: '@RichGarrick',
  displayName: 'Rich Garrick',
  profileUrl: 'https://x.com/RichGarrick',
  /** Encoded in public/donate-qr.png — keep these in sync */
  donateUrl: 'https://x.com/RichGarrick',
  qrImage: '/donate-qr.png',
  blurb: 'Built off-grid in rural Alaska. Tips via X Money keep the solar deck running.',
} as const;
