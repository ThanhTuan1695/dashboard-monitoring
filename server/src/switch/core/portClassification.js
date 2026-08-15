// Automatic uplink detection (spec's "multiple signals" idea, scoped down to
// what a name-based heuristic can do without LLDP/LACP data) — deliberately
// narrow and text-based, same spirit as the firewall connector's `wan*`
// interface-name heuristic: it only ever recognizes an explicit naming
// convention, never guesses from traffic patterns or speed alone. Manual
// user classification (not implemented this pass) is meant to override this.
const UPLINK_NAME_PATTERN = /uplink|core|dist|\bwan\b|\bfw\b|firewall|router/i;

function classifyPort(ifaceName) {
  return UPLINK_NAME_PATTERN.test(ifaceName || '') ? 'UPLINK' : 'NORMAL';
}

module.exports = { classifyPort };
