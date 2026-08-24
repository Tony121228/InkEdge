(function () {
  const storageKey = 'essayCoachTheme';
  const root = document.documentElement;
  let transitionTimer = null;

  function systemTheme() {
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function currentTheme() {
    return localStorage.getItem(storageKey) || 'light';
  }

  function applyTheme(theme) {
    root.dataset.theme = theme;
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.textContent = theme === 'light' ? '深' : '浅';
      button.setAttribute('aria-label', theme === 'light' ? '切换到深色模式' : '切换到浅色模式');
      button.setAttribute('title', theme === 'light' ? '切换到深色模式' : '切换到浅色模式');
    });
  }

  function toggleTheme() {
    const next = root.dataset.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem(storageKey, next);
    runThemeTransition(next);
  }

  function runThemeTransition(next) {
    if (transitionTimer) {
      clearTimeout(transitionTimer);
      transitionTimer = null;
    }

    document.querySelector('.theme-transition-layer')?.remove();

    const layer = document.createElement('div');
    layer.className = `theme-transition-layer ${next === 'light' ? 'to-light' : 'to-dark'}`;
    document.body.appendChild(layer);

    requestAnimationFrame(() => {
      layer.classList.add('active');
    });

    transitionTimer = setTimeout(() => {
      applyTheme(next);
      layer.classList.add('settle');
    }, 360);

    setTimeout(() => {
      layer.remove();
      transitionTimer = null;
    }, 980);
  }

  applyTheme(currentTheme());

  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(currentTheme());
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.addEventListener('click', toggleTheme);
    });
  });
})();
