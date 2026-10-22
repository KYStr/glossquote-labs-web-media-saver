// Synthetic data only. Nothing here performs network, disk, or process work.
export const METADATA = Object.freeze({ durationSeconds: 12, totalBytes: null });
export const ARTIFACT = Object.freeze({ artifactId: 'download-candidate', bytes: 120, durationSeconds: 12 });
export const VERIFICATION = Object.freeze({ ok: true, artifactId: 'verified-fixture' });

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export function makeFakeAdapter() {
  const calls = { inspect: [], download: [], verify: [], stop: [] };
  const adapter = Object.fromEntries(Object.keys(calls).map(method => [method, request => {
    const pending = deferred();
    calls[method].push({ request, ...pending });
    return pending.promise;
  }]));
  return { adapter, calls };
}

export function manualScheduler() {
  let time = 0;
  let next = 0;
  const timers = new Map();
  return {
    scheduler: {
      setTimeout: (fn, delay) => { const handle = ++next; timers.set(handle, { fn, at: time + delay }); return handle; },
      clearTimeout: handle => { timers.delete(handle); },
    },
    pendingCount: () => timers.size,
    advance: duration => {
      const target = time + duration;
      while (true) {
        const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
        if (!due.length) break;
        const [handle, timer] = due[0];
        time = timer.at;
        timers.delete(handle);
        timer.fn();
      }
      time = target;
    },
  };
}

export async function flush() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}
