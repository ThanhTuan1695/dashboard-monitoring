// Shared by every connector-monitored device type — discovery's reachability
// probes and vendor fingerprinting have no device-type-specific fields.
export default function DiscoveryResultCard({ result, unknownVendorLabel = 'Unknown vendor' }) {
  return (
    <div className="card mb-3">
      <div className="card-body">
        <h6 className="card-title">Discovery result</h6>
        <ul className="list-unstyled mb-2">
          <li>
            <i className={`bi ${result.reachability.icmp ? 'bi-check-circle text-success' : 'bi-x-circle text-secondary'} me-1`}></i>
            ICMP
          </li>
          <li>
            <i className={`bi ${result.reachability.https ? 'bi-check-circle text-success' : 'bi-x-circle text-secondary'} me-1`}></i>
            HTTPS
          </li>
          <li>
            <i className={`bi ${result.reachability.snmp ? 'bi-check-circle text-success' : 'bi-x-circle text-secondary'} me-1`}></i>
            SNMP
          </li>
          <li>
            <i className={`bi ${result.reachability.netconf ? 'bi-check-circle text-success' : 'bi-x-circle text-secondary'} me-1`}></i>
            NETCONF
          </li>
        </ul>
        <p className="mb-0">
          Detected:{' '}
          <strong>{result.fingerprint.vendor ? `${result.fingerprint.vendor} ${result.fingerprint.product || ''}` : unknownVendorLabel}</strong>
          {result.fingerprint.vendor && ` (confidence ${Math.round(result.fingerprint.confidence * 100)}%)`}
        </p>
        {!result.fingerprint.vendor && (
          <p className="text-secondary fs-7 mb-0 mt-1">
            Reachable, but not enough evidence to identify a vendor — full health monitoring may require credentials.
          </p>
        )}
      </div>
    </div>
  );
}
