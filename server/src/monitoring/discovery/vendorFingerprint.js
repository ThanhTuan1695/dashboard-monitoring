// Returns confidence, never a blind guess (spec §13) — below CONFIDENCE_THRESHOLD
// the caller reports "Unknown Firewall" rather than a wrong vendor name.
const CONFIDENCE_THRESHOLD = 0.5;

/**
 * FortiGate is the only vendor scorer implemented this pass. Adding another
 * vendor is just another function like this one, included in `SCORERS` below —
 * nothing else in discoveryService/ConnectorManager/React needs to change.
 */
function scoreFortiGate({ snmp, https }) {
  const evidence = [];
  let score = 0;

  const sysDescr = snmp?.sysDescr || '';
  if (/fortigate|fortios/i.test(sysDescr)) {
    score += 0.6;
    evidence.push('SNMP sysDescr mentions FortiGate/FortiOS');
  }

  const title = https?.title || '';
  if (/fortigate/i.test(title)) {
    score += 0.25;
    evidence.push('HTTPS page title mentions FortiGate');
  }

  const tlsSubject = https?.tlsSubject || '';
  if (/fortigate|fortinet/i.test(tlsSubject)) {
    score += 0.2;
    evidence.push('TLS certificate CN/O mentions Fortinet/FortiGate');
  }

  const server = https?.server || '';
  if (/fortiweb|fortihttp/i.test(server)) {
    score += 0.1;
    evidence.push(`HTTP Server header: ${server}`);
  }

  let product = null;
  const modelMatch = sysDescr.match(/FortiGate-?(\S+)/i);
  if (modelMatch) product = `FortiGate ${modelMatch[1]}`.replace(/,$/, '');
  else if (score > 0) product = 'FortiGate';

  return { vendor: score > 0 ? 'fortinet' : null, product, confidence: Math.min(1, score), evidence };
}

const SCORERS = [scoreFortiGate];

function fingerprint({ snmp, https }) {
  const candidates = SCORERS.map((score) => score({ snmp, https }));
  const best = candidates.reduce((a, b) => (b.confidence > a.confidence ? b : a), {
    vendor: null,
    product: null,
    confidence: 0,
    evidence: [],
  });

  if (best.confidence < CONFIDENCE_THRESHOLD) {
    return { vendor: null, product: null, confidence: best.confidence, evidence: best.evidence };
  }
  return best;
}

module.exports = { fingerprint, CONFIDENCE_THRESHOLD };
