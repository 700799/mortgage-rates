// Drawer navigation — injected on every page (index.html, privacy.html, …).
// Reads optional data-drawer-here-attr on body to mark the current page link.
(function () {
  const drawerHTML = `
<div class="drawer-backdrop" id="drawer-backdrop" hidden></div>
<aside class="drawer" id="drawer" aria-hidden="true" aria-label="Site navigation" tabindex="-1">
  <div class="drawer-head">
    <span class="brand-mark" aria-hidden="true">%</span>
    <strong class="drawer-title">Daily Mortgage Rates</strong>
    <button type="button" class="drawer-close" id="drawer-close" aria-label="Close menu">×</button>
  </div>
  <nav class="drawer-nav" aria-label="Site sections">
    <div class="drawer-section">
      <h3>Dashboard</h3>
      <a href="./index.html#chart-heading">Rate trend</a>
      <a href="./index.html#rate-table-heading">Today's rates by source</a>
      <a href="./index.html#lenders-heading">Top lenders by state</a>
      <a href="./index.html#offers-heading">Compare offers</a>
      <a href="./index.html#actions-heading">Actions to take</a>
      <a href="./index.html#tricks-heading">Lender tricks &amp; negotiation</a>
      <a href="./index.html#driver-heading">Rate drivers</a>
      <a href="./index.html#related-heading">Related indicators</a>
      <a href="./index.html#key-heading">Key indicators</a>
      <a href="./index.html#payoff-heading">Payoff calculator</a>
      <a href="./index.html#news-heading">News</a>
    </div>
    <div class="drawer-section">
      <h3>Pages</h3>
      <a href="./index.html" data-page="home">Home</a>
      <a href="./privacy.html" data-page="privacy">Privacy Policy</a>
      <a href="https://github.com/700799/mortgage-rates" target="_blank" rel="noopener">Source on GitHub ↗</a>
    </div>
  </nav>
</aside>`;

  function setup() {
    if (document.getElementById('drawer')) return;
    document.body.insertAdjacentHTML('beforeend', drawerHTML);

    const drawer   = document.getElementById('drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    const closeBtn = document.getElementById('drawer-close');
    const hamburger = document.querySelector('.hamburger');

    const currentPage = document.body.dataset.page;
    if (currentPage) {
      const active = drawer.querySelector(`a[data-page="${currentPage}"]`);
      if (active) active.setAttribute('aria-current', 'page');
    }

    let lastFocus = null;
    function open() {
      lastFocus = document.activeElement;
      drawer.classList.add('open');
      backdrop.hidden = false;
      drawer.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      closeBtn.focus();
    }
    function close() {
      drawer.classList.remove('open');
      backdrop.hidden = true;
      drawer.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    }

    if (hamburger) hamburger.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.classList.contains('open')) close();
    });
    drawer.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
