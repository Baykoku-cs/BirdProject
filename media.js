(function (root) {
  'use strict';
  // Each modal opening owns its image and timer. Closing it cancels both.
  function startPhotoLoad({image, url, onState, timeoutMs = 8000,
    setTimer = setTimeout, clearTimer = clearTimeout}) {
    let active = true, timer;
    const stopTimer = () => { if (timer !== undefined) clearTimer(timer); timer = undefined; };
    const finish = state => { if (!active) return; stopTimer(); onState(state); };
    image.onload = () => finish('loaded');
    image.onerror = () => finish('error');
    if (url) {
      onState('loading');
      timer = setTimer(() => { timer = undefined; if (active) onState('timeout'); }, timeoutMs);
      image.src = url;
    } else {
      onState('absent');
    }
    return () => {
      active = false; stopTimer(); image.onload = null; image.onerror = null;
      image.removeAttribute('src');
    };
  }
  const api = {startPhotoLoad};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AtlasMedia = api;
})(typeof window !== 'undefined' ? window : globalThis);
