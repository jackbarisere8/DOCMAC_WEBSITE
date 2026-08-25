const DOCMAC_CONFIG = {
  // This GitHub asset endpoint downloads the APK directly; it does not open
  // the release-notes page in the visitor's browser.
  downloadUrl: 'https://github.com/jackbarisere8/DOCMAC/releases/latest/download/app-release.apk',
  version: 'v1.0.3'
};

document.addEventListener('DOMContentLoaded', () => {
  const downloadButton = document.getElementById('download-button');
  const version = document.getElementById('release-version');
  const year = document.getElementById('year');

  if (downloadButton) {
    downloadButton.href = DOCMAC_CONFIG.downloadUrl;
    downloadButton.setAttribute('aria-label', `Download Docmac ${DOCMAC_CONFIG.version} for Android`);
  }
  if (version) version.textContent = DOCMAC_CONFIG.version;
  if (year) year.textContent = new Date().getFullYear();

  const siteHeader = document.querySelector('.site-header');
  const menuToggle = document.querySelector('.menu-toggle');
  const siteNavigation = document.querySelector('.nav-links');

  if (siteHeader && menuToggle && siteNavigation) {
    const menuScrim = document.createElement('button');
    menuScrim.className = 'menu-scrim';
    menuScrim.type = 'button';
    menuScrim.setAttribute('aria-label', 'Close navigation menu');
    document.body.append(menuScrim);

    const closeMenu = () => {
      siteHeader.classList.remove('menu-open');
      document.body.classList.remove('menu-open');
      menuScrim.classList.remove('is-visible');
      menuToggle.setAttribute('aria-expanded', 'false');
      menuToggle.setAttribute('aria-label', 'Open navigation menu');
    };

    const openMenu = () => {
      siteHeader.classList.add('menu-open');
      document.body.classList.add('menu-open');
      menuScrim.classList.add('is-visible');
      menuToggle.setAttribute('aria-expanded', 'true');
      menuToggle.setAttribute('aria-label', 'Close navigation menu');
    };

    menuToggle.addEventListener('click', () => {
      if (siteHeader.classList.contains('menu-open')) closeMenu();
      else openMenu();
    });

    menuScrim.addEventListener('click', closeMenu);

    siteNavigation.addEventListener('click', (event) => {
      if (event.target.closest('a')) closeMenu();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMenu();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 980) closeMenu();
    });
  }

  const feedbackForm = document.getElementById('feedback-form');
  if (feedbackForm) {
    feedbackForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = new FormData(feedbackForm);
      const name = form.get('name')?.trim() || 'Not provided';
      const email = form.get('email')?.trim() || 'Not provided';
      const topic = form.get('topic') || 'Website feedback';
      const message = form.get('message')?.trim() || '';
      const subject = `Docmac feedback: ${topic}`;
      const body = `Name: ${name}\nEmail: ${email}\nTopic: ${topic}\n\nFeedback:\n${message}`;
      window.location.href = `mailto:jackbarisere8@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    });
  }
});
