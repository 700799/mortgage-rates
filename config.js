// Site configuration — paste your real IDs/links here. Anything left as a
// placeholder (X's, 0's, "example.com", "...") stays inert: the related
// feature hides cleanly until you fill it in.
window.SITE_CONFIG = {
  // Your custom domain once purchased (used for canonical + Open Graph URLs).
  domain: "https://www.example.com",

  // Email/SMS capture — create a form at https://formspree.io, paste its endpoint.
  formspreeEndpoint: "https://formspree.io/f/xxxxxxxx",

  // Google AdSense — set enabled:true and paste your publisher id + slot ids
  // after approval (https://www.google.com/adsense). Ads only load after the
  // visitor accepts cookies.
  adsense: {
    enabled: false,
    client: "ca-pub-XXXXXXXXXXXXXXXX",
    slots: {
      leaderboard: "0000000000",
      inContent:   "0000000000",
      footer:      "0000000000",
    },
  },

  // Lender lead-gen / affiliate links. Add one object per partner; empty or
  // placeholder URLs are skipped. `cta` is the button label.
  affiliates: [
    // { name: "Credible",    url: "https://www.credible.com/...",    cta: "Compare rates" },
    // { name: "LendingTree", url: "https://www.lendingtree.com/...", cta: "Get quotes" },
  ],

  // Google Analytics 4 — paste your Measurement ID (G-XXXXXXXXXX). Loads only
  // after the visitor accepts cookies.
  ga4: { measurementId: "G-XXXXXXXXXX" },
};

// Back-compat alias for the existing form code.
window.FORMSPREE_ENDPOINT = window.SITE_CONFIG.formspreeEndpoint;
