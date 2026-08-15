/**
 * SNMP has no "current bandwidth" OID — only ever-increasing byte counters
 * (ifHCInOctets/ifHCOutOctets). Bandwidth is a rate, so it only exists as a
 * diff between two consecutive polls over a known time interval. Shared by
 * both firewall and switch pollers (identical math, only the interface
 * shape's other fields differ).
 *
 * Never fabricates a value: the first-ever poll (no prior snapshot), a
 * counter that went backwards (interface reset/reboot), or an interface with
 * no prior counterpart (renamed/new) all yield `null` rather than a garbage
 * or negative number.
 */
function round2(n) {
  return Math.round(n * 100) / 100;
}

function computeInterfaceBandwidth(currentInterfaces, previousInterfaces, previousCollectedAt, currentCollectedAt) {
  const deltaSeconds =
    previousCollectedAt && currentCollectedAt ? (new Date(currentCollectedAt).getTime() - new Date(previousCollectedAt).getTime()) / 1000 : null;
  const prevByName = new Map((previousInterfaces || []).map((i) => [i.name, i]));

  const rateFor = (current, previous) => {
    if (!deltaSeconds || deltaSeconds <= 0) return null;
    if (current == null || previous == null || current < previous) return null;
    return round2(((current - previous) * 8) / deltaSeconds / 1_000_000);
  };

  const interfaces = (currentInterfaces || []).map((iface) => {
    const prev = prevByName.get(iface.name);
    const rxMbps = rateFor(iface.rxOctets, prev?.rxOctets);
    const txMbps = rateFor(iface.txOctets, prev?.txOctets);
    const utilizationPercent =
      iface.speedMbps > 0 && (rxMbps !== null || txMbps !== null)
        ? Math.round((Math.max(rxMbps || 0, txMbps || 0) / iface.speedMbps) * 100)
        : null;
    return { ...iface, rxMbps, txMbps, utilizationPercent };
  });

  const rxValues = interfaces.map((i) => i.rxMbps).filter((v) => v !== null);
  const txValues = interfaces.map((i) => i.txMbps).filter((v) => v !== null);

  return {
    interfaces,
    bandwidth: {
      totalRxMbps: rxValues.length ? round2(rxValues.reduce((sum, v) => sum + v, 0)) : null,
      totalTxMbps: txValues.length ? round2(txValues.reduce((sum, v) => sum + v, 0)) : null,
    },
  };
}

module.exports = { computeInterfaceBandwidth };
