// Single source of truth for the numeric thresholds every device type's
// Health Engine uses — shared so a value is never duplicated (and drifts)
// between the firewall and switch connectors.
module.exports = {
  CPU_DEGRADED_PERCENT: 85,
  CPU_CRITICAL_PERCENT: 95,
  MEMORY_DEGRADED_PERCENT: 85,
  MEMORY_CRITICAL_PERCENT: 95,
  DISK_DEGRADED_PERCENT: 85,
  DISK_CRITICAL_PERCENT: 95,
  // How many days a license can be within expiry before it counts as "near expiration" (DEGRADED) — firewall only.
  LICENSE_EXPIRY_WARNING_DAYS: 14,
  // PoE budget utilization thresholds — switch only.
  POE_DEGRADED_PERCENT: 80,
  POE_CRITICAL_PERCENT: 95,
  // How stale a discovery result can be before a poll re-runs it — discovery and polling are separate cadences.
  DISCOVERY_STALE_MS: 6 * 60 * 60 * 1000, // 6 hours
};
