const pLimitFactory = require('p-limit');
const Device = require('../models/Device');
const StatusEvent = require('../models/StatusEvent');
const checks = require('./checks');
const alerts = require('./alerts');
const firewallPollingService = require('../firewall/services/firewallPollingService');
const switchPollingService = require('../switch/services/switchPollingService');

// Which device types run the shared connector pipeline (discover -> ConnectorManager
// -> Health Engine) instead of a plain reachability check, and which service handles it.
const CONNECTOR_POLLERS = { firewall: firewallPollingService.poll, switch: switchPollingService.poll };

const CONCURRENCY = Number(process.env.CHECK_CONCURRENCY || 20);

class MonitorScheduler {
  constructor(io) {
    this.io = io;
    this.timers = new Map(); // deviceId -> Timeout
    this.inFlight = new Set(); // Promises from checks currently running, so stop() can wait them out
    this.limit = pLimitFactory(CONCURRENCY);
    this.running = false;
  }

  async start() {
    this.running = true;
    const devices = await Device.find({});
    devices.forEach((device) => this.scheduleDevice(device._id.toString(), true));
    console.log(`[scheduler] started, scheduled ${devices.length} device(s)`);
  }

  /**
   * Clearing timers alone only stops *future* ticks — a check already in
   * flight (mid-`checkAndUpdate`, e.g. awaiting the network probe) would
   * otherwise keep running and try to `device.save()` after the caller
   * disconnects Mongo right after this returns. Wait for those to settle too.
   */
  async stop() {
    this.running = false;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.allSettled([...this.inFlight]);
  }

  /** (Re)schedules a device's recurring check. `initialJitter` staggers first-run load. */
  scheduleDevice(deviceId, initialJitter = false) {
    this.cancelDevice(deviceId);
    if (!this.running) return;

    const jitterMs = initialJitter ? Math.floor(Math.random() * 5000) : 0;
    const timer = setTimeout(() => this.tick(deviceId), jitterMs);
    this.timers.set(deviceId, timer);
  }

  cancelDevice(deviceId) {
    const existing = this.timers.get(deviceId);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(deviceId);
    }
  }

  async tick(deviceId) {
    if (!this.running) return;
    const device = await Device.findById(deviceId);
    if (!device) return; // deleted since last schedule

    await this.checkAndUpdate(device);

    // Re-arm for the next cycle using the device's own interval.
    if (this.running && this.timers.has(deviceId)) {
      const intervalMs = (device.monitor?.intervalSeconds || 60) * 1000;
      const timer = setTimeout(() => this.tick(deviceId), intervalMs);
      this.timers.set(deviceId, timer);
    }
  }

  /** Runs one check for a device (via the concurrency limiter), applies flap-damping, persists, emits. */
  checkAndUpdate(device) {
    const promise = this._checkAndUpdate(device);
    this.inFlight.add(promise);
    const untrack = () => this.inFlight.delete(promise);
    promise.then(untrack, untrack);
    return promise;
  }

  async _checkAndUpdate(device) {
    // The shared connector pipeline (discovery + connector fallback + Health
    // Engine) replaces the simple reachability check for this method, but
    // still returns the same {ok,latencyMs,error} shape everything below expects.
    const connectorPoll = device.monitor?.method === 'connector' ? CONNECTOR_POLLERS[device.type] : null;
    const runner = connectorPoll ? () => connectorPoll(device) : () => checks.runCheck(device);
    const result = await this.limit(runner);
    const previousStatus = device.status?.current || 'unknown';
    const downAfterFailures = device.monitor?.downAfterFailures ?? 2;

    let nextStatus = previousStatus;
    let consecutiveFailures = device.status?.consecutiveFailures || 0;

    if (result.ok) {
      consecutiveFailures = 0;
      nextStatus = 'up';
    } else {
      consecutiveFailures += 1;
      if (consecutiveFailures >= downAfterFailures) {
        nextStatus = 'down';
      } else if (previousStatus === 'unknown') {
        // Not yet confirmed down, but not yet confirmed up either — keep unknown
        // until the failure threshold is reached, unless we were already up
        // (in which case leave as "up" until threshold trips, i.e. flap damping).
        nextStatus = previousStatus;
      }
    }

    const now = new Date();
    device.status.lastCheckedAt = now;
    device.status.consecutiveFailures = consecutiveFailures;
    device.status.latencyMs = result.ok ? result.latencyMs : device.status.latencyMs;
    device.status.lastError = result.error;

    const changed = nextStatus !== previousStatus;
    if (changed) {
      device.status.current = nextStatus;
      device.status.lastChangedAt = now;
    }

    await device.save();

    if (changed) {
      await StatusEvent.create({
        device: device._id,
        previousStatus,
        status: nextStatus,
        at: now,
      });

      await alerts.notifyStatusChange(device, previousStatus, nextStatus, now);

      if (this.io) {
        this.io.to('status').emit('device:status-changed', {
          deviceId: device._id.toString(),
          status: nextStatus,
          previousStatus,
          checkedAt: now,
        });
      }
    }

    return { device, result, changed };
  }

  /** On-demand check triggered from the API, bypassing the schedule timing. */
  async checkNow(deviceId) {
    const device = await Device.findById(deviceId);
    if (!device) throw new Error('Device not found');
    return this.checkAndUpdate(device);
  }
}

module.exports = MonitorScheduler;
