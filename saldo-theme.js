(() => {
  const storageKey = 'saldo-theme';
  const choices = new Set(['system', 'light', 'dark']);
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const normalize = value => choices.has(value) ? value : 'system';
  let preference = 'system';

  try { preference = normalize(localStorage.getItem(storageKey)); } catch { /* Keep the system theme. */ }

  function apply() {
    const dark = preference === 'dark' || (preference === 'system' && system.matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    if (themeColor) themeColor.content = dark ? '#111b17' : '#f7f8f5';
  }

  function setPreference(value) {
    preference = normalize(value);
    try { localStorage.setItem(storageKey, preference); } catch { /* Use the preference for this visit. */ }
    apply();
  }

  apply();
  if (system.addEventListener) system.addEventListener('change', apply);
  else system.addListener(apply);
  window.addEventListener('storage', event => {
    if (event.key !== storageKey && event.key !== null) return;
    preference = normalize(event.newValue);
    apply();
    const select = document.getElementById('saldo-theme');
    if (select) select.value = preference;
  });

  window.SaldoTheme = { preference: () => preference, setPreference };
})();
