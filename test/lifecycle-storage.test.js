import test from "node:test";
import assert from "node:assert/strict";
import { StatusMonitor, inactivityReached, statusIsStale, statusPollInterval } from "../src/lifecycle.js";
import { loadState } from "../src/storage.js";
import { SCHEMA_VERSION } from "../src/model.js";

test("model status polls only while warming and inactivity threshold is respected", () => {
  assert.equal(statusPollInterval("ready"), null);
  assert.equal(statusPollInterval("warming"), 4000);
  assert.equal(statusIsStale(100, 100 + 59_999), false);
  assert.equal(statusIsStale(100, 100 + 60_000), true);
  assert.equal(inactivityReached(100, 10, 100 + 9 * 60_000), false);
  assert.equal(inactivityReached(100, 10, 100 + 10 * 60_000), true);

  let now = 100;
  const scheduled = [];
  let stale = 0;
  const monitor = new StatusMonitor({
    getInactivityMinutes: () => 10,
    onStale: () => stale++,
    onTimeout: () => {},
    now: () => now,
    setTimer: (fn, delay) => { scheduled.push({ fn, delay }); return scheduled.length; },
    clearTimer: () => {},
    setIntervalTimer: (fn) => { monitor.inactivityCheck = fn; return 1; },
    clearIntervalTimer: () => {}
  });
  monitor.start();
  let checks = 0;
  monitor.observe("ready", () => checks++);
  assert.equal(scheduled.length, 0);
  monitor.observe("warming", () => checks++);
  assert.equal(scheduled[0].delay, 4000);
  scheduled[0].fn();
  assert.equal(checks, 1);
  now += 10 * 60_000;
  monitor.inactivityCheck();
  assert.equal(stale, 1);
  assert.equal(monitor.pollTimer, null);
  monitor.close();
});

test("default monitor timers retain the browser global receiver", (context) => {
  const timerNames = ["setTimeout", "clearTimeout", "setInterval", "clearInterval"];
  const originalTimers = Object.fromEntries(timerNames.map((name) => [name, globalThis[name]]));
  const calls = [];
  context.after(() => Object.assign(globalThis, originalTimers));
  for (const name of timerNames) {
    globalThis[name] = function () {
      assert.equal(this, globalThis, `${name} must be called on the browser global`);
      calls.push(name);
      return calls.length;
    };
  }
  const monitor = new StatusMonitor({
    getInactivityMinutes: () => 10,
    onStale: () => {},
    onTimeout: () => {}
  });
  monitor.start();
  monitor.observe("warming", () => {});
  monitor.observe("ready", () => {});
  monitor.start();
  monitor.observe("warming", () => {});
  monitor.close();
  assert.deepEqual(calls, [
    "setInterval", "setTimeout", "clearTimeout", "clearInterval",
    "setInterval", "setTimeout", "clearTimeout", "clearInterval"
  ]);
});

test("legacy storage migrates to the current version with defaults", async () => {
  let stored;
  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ jobCaptureState: { jobs: [{ url: "https://example.test/job", cleaned_text: "Required: 4 years" }] } }),
        set: async (value) => { stored = value.jobCaptureState; }
      }
    }
  };
  const state = await loadState();
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  assert.equal(state.jobs[0].source_url, "https://example.test/job");
  assert.equal(state.jobs[0].description_text, "Required: 4 years");
  assert.equal(state.settings.llmEnabled, false);
  assert.equal(stored.schemaVersion, SCHEMA_VERSION);
  delete globalThis.chrome;
});
