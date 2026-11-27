// When many apps fail in the same run, the problem may be Pulse's own internet connection.
// Pulse then checks two neutral sites on unrelated networks; if both fail, the run isn't counted
// against any app. Two, because vexto.app's DNS is on Cloudflare: a Cloudflare outage alone must
// still show as an app outage, not as Pulse being offline.
export const REFERENCE_URLS = ['https://www.cloudflare.com/cdn-cgi/trace', 'https://www.google.com/generate_204'];
const MIN_FAILED = 3;

export const needsReferenceCheck = (failed: number) => failed >= MIN_FAILED;

export const pulseOffline = (failed: number, referenceOk: boolean) => needsReferenceCheck(failed) && !referenceOk;
