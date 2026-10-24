// Small hook: app.js calls it for every message from the app; here the result of "test that it works" goes to the cards.
window.stonesHook = (m) => {
  if (m.type === 'brainTest') { S.brainTests = S.brainTests || {}; S.brainTests[m.kind] = m; if (typeof renderProviders === 'function') renderProviders(); }
};
