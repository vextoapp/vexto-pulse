// When many apps fail in the same run, the problem may be Pulse's own internet connection.
// Pulse then checks a neutral site; if that fails too, the run isn't counted against any app.
export const REFERENCE_URL = 'https://www.cloudflare.com/cdn-cgi/trace';
const MIN_FAILED = 3;

export const needsReferenceCheck = (failed: number) => failed >= MIN_FAILED;

export const pulseOffline = (failed: number, referenceOk: boolean) => needsReferenceCheck(failed) && !referenceOk;
