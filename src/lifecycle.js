export function inactivityReached(lastActivity, inactivityMinutes, now = Date.now()) {
  return now - lastActivity >= inactivityMinutes * 60_000;
}

export function statusPollInterval(state) {
  return state === "warming" ? 4000 : null;
}

export function statusIsStale(lastChecked, now = Date.now(), maxAgeMs = 60_000) {
  return !lastChecked || now - lastChecked >= maxAgeMs;
}

export class StatusMonitor {
  constructor({ getInactivityMinutes, onStale, onTimeout, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, setIntervalTimer = setInterval, clearIntervalTimer = clearInterval }) {
    this.getInactivityMinutes = getInactivityMinutes;
    this.onStale = onStale;
    this.onTimeout = onTimeout;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.setIntervalTimer = setIntervalTimer;
    this.clearIntervalTimer = clearIntervalTimer;
    this.lastActivity = now();
    this.warmStartedAt = 0;
    this.stale = false;
    this.pollTimer = null;
    this.inactivityTimer = null;
    this.closed = false;
  }

  touch() {
    this.lastActivity = this.now();
    this.stale = false;
  }

  isIdle() {
    return inactivityReached(this.lastActivity, this.getInactivityMinutes(), this.now());
  }

  observe(state, check) {
    if (this.closed) return;
    if (this.pollTimer) this.clearTimer(this.pollTimer);
    this.pollTimer = null;
    if (state !== "unknown") this.stale = false;
    if (state !== "warming") {
      this.warmStartedAt = 0;
      return;
    }
    if (!this.warmStartedAt) this.warmStartedAt = this.now();
    if (this.isIdle()) return this.markStale();
    if (this.now() - this.warmStartedAt >= 180_000) return this.onTimeout();
    this.pollTimer = this.setTimer(() => {
      if (this.isIdle()) return this.markStale();
      if (this.now() - this.warmStartedAt >= 180_000) return this.onTimeout();
      check();
    }, statusPollInterval(state));
  }

  start() {
    if (this.closed) return;
    if (this.inactivityTimer) this.clearIntervalTimer(this.inactivityTimer);
    this.inactivityTimer = this.setIntervalTimer(() => {
      if (this.isIdle()) this.markStale();
    }, 15_000);
  }

  markStale() {
    if (this.closed) return;
    if (this.stale) return;
    this.stale = true;
    if (this.pollTimer) this.clearTimer(this.pollTimer);
    this.pollTimer = null;
    this.warmStartedAt = 0;
    this.onStale();
  }

  close() {
    this.closed = true;
    if (this.pollTimer) this.clearTimer(this.pollTimer);
    if (this.inactivityTimer) this.clearIntervalTimer(this.inactivityTimer);
    this.pollTimer = null;
    this.inactivityTimer = null;
  }
}
