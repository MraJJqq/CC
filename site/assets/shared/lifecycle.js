/**
 * Owns every disposable resource created by one runtime module.
 * A scope is idempotent: destroying it more than once is safe.
 */
export function createLifecycleScope() {
  let disposed = false;
  const cleanups = [];
  const controller = new AbortController();

  function own(dispose) {
    if (typeof dispose !== "function") throw new TypeError("dispose must be a function");
    if (disposed) {
      dispose();
      return () => {};
    }

    let active = true;
    const release = () => {
      if (!active) return;
      active = false;
      const index = cleanups.indexOf(release);
      if (index !== -1) cleanups.splice(index, 1);
      dispose();
    };
    cleanups.push(release);
    return release;
  }

  function listen(target, type, handler, options) {
    if (disposed) return () => {};
    target.addEventListener(type, handler, options);
    return own(() => target.removeEventListener(type, handler, options));
  }

  function timeout(callback, delay) {
    if (disposed) return () => {};
    let release = () => {};
    const id = setTimeout(() => {
      release();
      if (!disposed) callback();
    }, delay);
    release = own(() => clearTimeout(id));
    return release;
  }

  function interval(callback, delay) {
    if (disposed) return () => {};
    const id = setInterval(() => {
      if (!disposed) callback();
    }, delay);
    return own(() => clearInterval(id));
  }

  function animationFrame(callback) {
    if (disposed) return () => {};
    let release = () => {};
    const id = requestAnimationFrame(time => {
      release();
      if (!disposed) callback(time);
    });
    release = own(() => cancelAnimationFrame(id));
    return release;
  }

  function observe(observer) {
    if (!observer || typeof observer.disconnect !== "function") {
      throw new TypeError("observer must support disconnect()");
    }
    return own(() => observer.disconnect());
  }

  function child() {
    const nested = createLifecycleScope();
    own(() => nested.destroy());
    return nested;
  }

  function destroy() {
    if (disposed) return;
    disposed = true;
    controller.abort();
    while (cleanups.length) {
      const release = cleanups[cleanups.length - 1];
      try {
        release();
      } catch (error) {
        console.warn("[VEGAS V6 lifecycle] cleanup failed", error);
      }
    }
  }

  return {
    get disposed() {
      return disposed;
    },
    get signal() {
      return controller.signal;
    },
    own,
    listen,
    timeout,
    interval,
    animationFrame,
    observe,
    child,
    destroy
  };
}
