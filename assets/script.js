/* Docmac site behaviour: theme, navigation, release catalogue, verification, feedback. */
(() => {
  'use strict';

  document.documentElement.classList.add('js');

  const THEME_KEY = 'docmac-theme';
  const SUPPORT_EMAIL = 'jackbarisere8@gmail.com';
  const scriptElement = document.currentScript;
  const SCRIPT_URL = scriptElement?.src || new URL('assets/script.js', window.location.href).href;
  const ICON_SPRITE = new URL('icons.svg', SCRIPT_URL).href;
  const RELEASE_ENDPOINT = new URL('../releases.json', SCRIPT_URL).href;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const safeHttpsUrl = (value) => {
    try {
      const url = new URL(value, window.location.href);
      return url.protocol === 'https:' ? url.href : '';
    } catch (error) {
      return '';
    }
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';

  const createIcon = (id, className = 'icon') => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', className);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `${ICON_SPRITE}#${id}`);
    svg.append(use);
    return svg;
  };

  /* ---------------------------------------------------------------------- */
  /* Theme                                                                   */
  /* ---------------------------------------------------------------------- */

  const themeColorMeta = $('meta[name="theme-color"]');
  const themeToggle = $('#theme-toggle');
  const themeButtons = $$('[data-theme]');

  function readTheme() {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored;

      // Migrate the old drawer-only preference.
      const legacy = localStorage.getItem('docmac-drawer-theme');
      if (legacy === 'light' || legacy === 'dark') {
        localStorage.setItem(THEME_KEY, legacy);
        localStorage.removeItem('docmac-drawer-theme');
        return legacy;
      }
    } catch (error) {
      /* Storage may be unavailable. */
    }
    return 'auto';
  }

  let theme = readTheme();

  function isDark() {
    return theme === 'dark' || (theme === 'auto' && prefersDark.matches);
  }

  function applyTheme(nextTheme, persist = true) {
    theme = nextTheme;
    const dark = isDark();

    document.documentElement.classList.toggle('site-dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';

    if (themeColorMeta) themeColorMeta.setAttribute('content', dark ? '#07150a' : '#f6f6f0');

    themeButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.theme === theme));
    });

    if (themeToggle) {
      const iconUse = $('[data-theme-icon] use', themeToggle);
      themeToggle.setAttribute('aria-pressed', String(dark));
      themeToggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
      if (iconUse) {
        const sprite = (iconUse.getAttribute('href') || 'assets/icons.svg').split('#')[0];
        iconUse.setAttribute('href', `${sprite}#${dark ? 'i-sun' : 'i-moon'}`);
      }
    }

    if (persist) {
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch (error) {
        /* The theme still applies for this page. */
      }
    }
  }

  applyTheme(theme, false);

  themeButtons.forEach((button) => {
    button.addEventListener('click', () => applyTheme(button.dataset.theme));
  });

  themeToggle?.addEventListener('click', () => {
    applyTheme(isDark() ? 'light' : 'dark');
  });

  const onSystemThemeChange = () => {
    if (theme === 'auto') applyTheme('auto', false);
  };
  if (typeof prefersDark.addEventListener === 'function') {
    prefersDark.addEventListener('change', onSystemThemeChange);
  } else if (typeof prefersDark.addListener === 'function') {
    prefersDark.addListener(onSystemThemeChange);
  }

  /* ---------------------------------------------------------------------- */
  /* Navigation drawer                                                       */
  /* ---------------------------------------------------------------------- */

  const siteHeader = $('.site-header');
  const menuToggle = $('.menu-toggle');
  const siteNavigation = $('#site-navigation');
  const main = $('#main');
  const siteFooter = $('.site-footer');

  if (siteHeader && menuToggle && siteNavigation) {
    let previouslyFocused = null;
    let scrim = $('.menu-scrim');

    if (!scrim) {
      scrim = document.createElement('button');
      scrim.className = 'menu-scrim';
      scrim.type = 'button';
      scrim.tabIndex = -1;
      scrim.setAttribute('aria-label', 'Close navigation menu');
      document.body.append(scrim);
    }

    const focusableElements = () =>
      $$('a[href], button:not([disabled])', siteNavigation).filter(
        (element) => element.getClientRects().length > 0,
      );

    const closeMenu = ({ restoreFocus = true } = {}) => {
      const wasOpen = siteHeader.classList.contains('menu-open');
      siteHeader.classList.remove('menu-open');
      document.body.classList.remove('menu-open');
      scrim.classList.remove('is-visible');
      menuToggle.setAttribute('aria-expanded', 'false');
      menuToggle.setAttribute('aria-label', 'Open navigation menu');
      main?.removeAttribute('inert');
      siteFooter?.removeAttribute('inert');

      if (wasOpen && restoreFocus && previouslyFocused instanceof HTMLElement) {
        previouslyFocused.focus();
      }
    };

    const openMenu = () => {
      previouslyFocused = document.activeElement;
      siteHeader.classList.add('menu-open');
      document.body.classList.add('menu-open');
      scrim.classList.add('is-visible');
      menuToggle.setAttribute('aria-expanded', 'true');
      menuToggle.setAttribute('aria-label', 'Close navigation menu');
      main?.setAttribute('inert', '');
      siteFooter?.setAttribute('inert', '');
      focusableElements()[0]?.focus();
    };

    menuToggle.addEventListener('click', () => {
      if (siteHeader.classList.contains('menu-open')) closeMenu();
      else openMenu();
    });

    scrim.addEventListener('click', () => closeMenu());

    const isModifiedClick = (event) =>
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;

    siteNavigation.addEventListener('click', (event) => {
      const link = event.target.closest('a[href]');
      if (!link || isModifiedClick(event) || link.target === '_blank') return;

      let url;
      try {
        url = new URL(link.getAttribute('href'), window.location.href);
      } catch (error) {
        return;
      }

      const samePage = url.origin === window.location.origin && url.pathname === window.location.pathname;

      if (samePage && url.hash) {
        event.preventDefault();
        closeMenu();
        const target = document.getElementById(url.hash.slice(1));
        if (!target) return;

        requestAnimationFrame(() => {
          target.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
          if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
          target.focus({ preventScroll: true });
          try {
            history.pushState(null, '', url.hash);
          } catch (error) {
            /* History updates are best-effort. */
          }
        });
        return;
      }

      // Cross-page links and plain same-page links keep normal browser behaviour.
      closeMenu({ restoreFocus: false });
    });

    document.addEventListener('keydown', (event) => {
      if (!siteHeader.classList.contains('menu-open')) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusables = focusableElements();
      if (!focusables.length) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    const desktop = window.matchMedia('(min-width: 981px)');
    const onDesktop = () => {
      if (desktop.matches) closeMenu({ restoreFocus: false });
    };
    if (typeof desktop.addEventListener === 'function') {
      desktop.addEventListener('change', onDesktop);
    } else if (typeof desktop.addListener === 'function') {
      desktop.addListener(onDesktop);
    }
  }

  // Make the skip link target focusable for screen readers.
  if (main && !main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');

  /* ---------------------------------------------------------------------- */
  /* Preloader                                                               */
  /* ---------------------------------------------------------------------- */

  const preloader = $('.preloader');
  if (preloader) {
    let introSeen = false;
    try {
      introSeen = sessionStorage.getItem('docmac-intro-seen') === '1';
    } catch (error) {
      /* Storage may be unavailable. */
    }

    if (introSeen || reducedMotion.matches) {
      document.documentElement.classList.add('intro-seen');
      preloader.remove();
    } else {
      let finished = false;
      const finishIntro = () => {
        if (finished) return;
        finished = true;
        preloader.classList.add('is-done');
        window.setTimeout(() => {
          document.documentElement.classList.add('intro-seen');
          preloader.remove();
        }, 850);
        try {
          sessionStorage.setItem('docmac-intro-seen', '1');
        } catch (error) {
          /* The intro still closes for this visit. */
        }
      };

      if (document.readyState === 'complete') {
        window.setTimeout(finishIntro, 650);
      } else {
        window.addEventListener('load', () => window.setTimeout(finishIntro, 650), { once: true });
      }
      window.setTimeout(finishIntro, 2800);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Header scroll state                                                     */
  /* ---------------------------------------------------------------------- */

  if (siteHeader) {
    let headerTick = false;
    const syncHeader = () => {
      siteHeader.classList.toggle('is-scrolled', window.scrollY > 24);
      headerTick = false;
    };
    syncHeader();
    window.addEventListener(
      'scroll',
      () => {
        if (headerTick) return;
        headerTick = true;
        requestAnimationFrame(syncHeader);
      },
      { passive: true },
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Scroll reveals                                                          */
  /* ---------------------------------------------------------------------- */

  const revealItems = $$('[data-reveal]');
  if (revealItems.length) {
    if (reducedMotion.matches || !('IntersectionObserver' in window)) {
      revealItems.forEach((element) => element.classList.add('is-visible'));
    } else {
      const revealObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('is-visible');
            revealObserver.unobserve(entry.target);
          });
        },
        { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
      );
      revealItems.forEach((element) => revealObserver.observe(element));
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Scrub statement                                                         */
  /* ---------------------------------------------------------------------- */

  const scrubHeadings = $$('[data-scrub]');
  if (scrubHeadings.length) {
    scrubHeadings.forEach((heading) => {
      const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
      const textNodes = [];
      while (walker.nextNode()) {
        if (walker.currentNode.nodeValue.trim()) textNodes.push(walker.currentNode);
      }

      textNodes.forEach((node) => {
        if (node.parentElement?.closest('.scrub-pill')) return;
        const fragment = document.createDocumentFragment();
        node.nodeValue.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) {
            fragment.append(part);
            return;
          }
          const word = document.createElement('span');
          word.className = 'scrub-word';
          word.textContent = part;
          fragment.append(word);
        });
        node.replaceWith(fragment);
      });
    });

    const scrubWords = scrubHeadings.flatMap((heading) => $$('.scrub-word', heading));
    scrubWords.forEach((word, index) => {
      word.style.setProperty('--word-delay', `${Math.min(index * 6, 90)}ms`);
    });

    let scrubTick = false;
    const updateScrub = () => {
      scrubTick = false;
      if (reducedMotion.matches) return;
      const viewport = window.innerHeight;
      scrubHeadings.forEach((heading) => {
        const words = $$('.scrub-word', heading);
        if (!words.length) return;
        const start = viewport * 0.86;
        const end = viewport * 0.2;
        const rect = heading.getBoundingClientRect();
        const distance = Math.max(1, rect.height + (start - end));
        const progress = Math.min(1, Math.max(0, (start - rect.top) / distance));
        const lit = Math.ceil(progress * words.length);
        words.forEach((word, index) => word.classList.toggle('is-lit', index < lit));
      });
    };

    const requestScrub = () => {
      if (scrubTick) return;
      scrubTick = true;
      requestAnimationFrame(updateScrub);
    };

    updateScrub();
    window.addEventListener('scroll', requestScrub, { passive: true });
    window.addEventListener('resize', requestScrub, { passive: true });
  }

  /* ---------------------------------------------------------------------- */
  /* Verified count-ups                                                      */
  /* ---------------------------------------------------------------------- */

  const counters = $$('[data-count]');
  if (counters.length && !reducedMotion.matches && 'IntersectionObserver' in window) {
    const countObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const element = entry.target;
          const target = Number(element.dataset.count);
          if (!Number.isFinite(target)) return;
          countObserver.unobserve(element);

          const duration = 1250;
          const started = performance.now();
          const tick = (now) => {
            const progress = Math.min(1, (now - started) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            element.textContent = String(Math.round(target * eased));
            if (progress < 1) requestAnimationFrame(tick);
            else element.dataset.counted = '1';
          };
          element.textContent = '0';
          requestAnimationFrame(tick);
        });
      },
      { threshold: 0.65 },
    );
    counters.forEach((element) => countObserver.observe(element));
  }

  /* ---------------------------------------------------------------------- */
  /* Trust accordion                                                         */
  /* ---------------------------------------------------------------------- */

  const trustAccordion = $('[data-auto-accordion]');
  if (trustAccordion) {
    const accordionItems = $$('.accordion-item', trustAccordion);
    const trustImages = $$('.trust-img', $('[data-trust-media]') || document);
    const captionTitle = $('[data-trust-caption-title]');
    const captionText = $('[data-trust-caption-text]');
    const captionIcon = $('.trust-caption-icon use');
    const captionSprite = (captionIcon?.getAttribute('href') || 'assets/icons.svg').split('#')[0];
    let activeAccordion = Math.max(
      0,
      accordionItems.findIndex((item) => item.classList.contains('is-open')),
    );
    let accordionTimer = null;
    let accordionPaused = false;

    const setAccordion = (index, { focus = false } = {}) => {
      activeAccordion = (index + accordionItems.length) % accordionItems.length;

      accordionItems.forEach((item, itemIndex) => {
        const trigger = $('.accordion-trigger', item);
        const panel = $('.accordion-panel', item);
        const isOpen = itemIndex === activeAccordion;
        item.classList.toggle('is-open', isOpen);
        trigger?.setAttribute('aria-expanded', String(isOpen));
        if (panel) {
          panel.inert = !isOpen;
          panel.setAttribute('aria-hidden', String(!isOpen));
        }
        if (isOpen && focus) trigger?.focus();
      });

      trustImages.forEach((image, imageIndex) => {
        image.classList.toggle('is-active', imageIndex === activeAccordion);
      });

      const trigger = $('.accordion-trigger', accordionItems[activeAccordion]);
      if (trigger && captionTitle && captionText) {
        captionTitle.textContent = trigger.dataset.captionTitle || 'Docmac release';
        captionText.textContent = trigger.dataset.captionText || '';
        if (captionIcon) {
          captionIcon.setAttribute('href', `${captionSprite}#${trigger.dataset.captionIcon || 'i-download'}`);
        }
      }
    };

    const stopAccordionTimer = () => {
      if (accordionTimer) window.clearInterval(accordionTimer);
      accordionTimer = null;
    };

    const startAccordionTimer = () => {
      stopAccordionTimer();
      if (reducedMotion.matches) return;
      accordionTimer = window.setInterval(() => {
        if (accordionPaused || document.hidden) return;
        setAccordion(activeAccordion + 1);
      }, 6200);
    };

    accordionItems.forEach((item, index) => {
      const trigger = $('.accordion-trigger', item);
      trigger?.addEventListener('click', () => {
        setAccordion(index);
        startAccordionTimer();
      });
    });

    trustAccordion.addEventListener('pointerenter', () => {
      accordionPaused = true;
    });
    trustAccordion.addEventListener('pointerleave', () => {
      accordionPaused = false;
    });
    trustAccordion.addEventListener('focusin', () => {
      accordionPaused = true;
    });
    trustAccordion.addEventListener('focusout', () => {
      accordionPaused = false;
    });

    setAccordion(activeAccordion);
    startAccordionTimer();
  }

  /* ---------------------------------------------------------------------- */
  /* Service cards                                                           */
  /* ---------------------------------------------------------------------- */

  const serviceCards = $$('.service-card');
  serviceCards.forEach((card) => {
    const toggle = $('.service-toggle', card);
    toggle?.addEventListener('click', () => {
      const willOpen = !card.classList.contains('is-active');
      serviceCards.forEach((otherCard) => {
        otherCard.classList.remove('is-active');
        $('.service-toggle', otherCard)?.setAttribute('aria-expanded', 'false');
      });
      if (willOpen) {
        card.classList.add('is-active');
        toggle.setAttribute('aria-expanded', 'true');
      }
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Release catalogue                                                       */
  /* ---------------------------------------------------------------------- */

  const downloadButton = $('#download-button');
  const releaseHistoryToggle = $('#release-history-toggle');
  const previousReleases = $('#previous-releases');
  const releaseStatus = $('#release-status');

  const formatDate = (isoDate) => {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return 'Date not published';
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(date);
  };

  const formatSize = (release) =>
    release.sizeLabel ||
    (Number.isFinite(release.sizeBytes) ? `${(release.sizeBytes / 1024 / 1024).toFixed(1)} MB` : 'Size unavailable');

  const versionLabel = (release) => `v${release.versionName}`;

  const setText = (selector, value) => {
    $$(selector).forEach((element) => {
      element.textContent = value;
    });
  };

  /* Release preview + archive carousel ------------------------------------- */

  const releaseTabsRoot = $('[data-release-tabs]');
  const releaseArc = $('[data-release-arc]');
  const heroVersion = $('#hero-version');
  const heroSize = $('#hero-size');
  const heroDate = $('#hero-date');
  const heroReleaseLink = $('#hero-release-link');
  const arcPrev = $('[data-arc-prev]');
  const arcNext = $('[data-arc-next]');
  const arcCurrent = $('[data-arc-current]');
  const arcTotal = $('[data-arc-total]');
  const arcStatus = $('[data-arc-status]');

  const SITE_ROOT = new URL('../', SCRIPT_URL);
  const releasePageHref = (release) =>
    new URL(`releases/${encodeURIComponent(release.versionName)}.html`, SITE_ROOT).href;

  const ARC_IMAGES = [
    'images/editorial/conversation.webp',
    'images/editorial/phone.webp',
    'images/editorial/portrait-friends.webp',
    'images/editorial/sunset.webp',
    'images/editorial/dinner.webp',
    'images/editorial/laughter.webp',
    'images/editorial/hero-crowd.webp',
  ].map((path) => new URL(path, SCRIPT_URL).href);

  const releaseState = {
    items: [],
    active: 0,
    cards: [],
  };

  let suppressArcClickUntil = 0;

  const releaseBadge = (release, index) => {
    if (release.yanked) return 'Yanked';
    if (release.channel === 'beta') return 'Beta';
    return index === 0 ? 'Latest' : 'Stable';
  };

  const releaseSummary = (release) => {
    const lines = String(release.releaseNotes || '')
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*•]\s*/, '').trim())
      .filter(Boolean);
    return lines[0] || 'No release notes were published for this build.';
  };

  function updateHud(release) {
    if (heroVersion) heroVersion.textContent = versionLabel(release);
    if (heroSize) heroSize.textContent = formatSize(release);
    if (heroDate) heroDate.textContent = formatDate(release.publishedAt);
    if (heroReleaseLink) {
      heroReleaseLink.href = releasePageHref(release);
      heroReleaseLink.setAttribute(
        'aria-label',
        `View Docmac ${versionLabel(release)} release details`,
      );
    }
  }

  function updateHudFromTab(tab) {
    const version = String(tab.dataset.version || '');
    if (heroVersion) heroVersion.textContent = version.startsWith('v') ? version : `v${version}`;
    if (heroSize && tab.dataset.size) heroSize.textContent = tab.dataset.size;
    if (heroDate && tab.dataset.date) heroDate.textContent = tab.dataset.date;
    if (heroReleaseLink && tab.dataset.link) {
      heroReleaseLink.href = tab.dataset.link;
      heroReleaseLink.setAttribute('aria-label', `View Docmac v${version} release details`);
    }
  }

  function updateTabState(versionName) {
    if (!releaseTabsRoot) return;
    $$('[data-release-tab]', releaseTabsRoot).forEach((tab) => {
      const active = Boolean(versionName) && tab.dataset.version === versionName;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-pressed', String(active));
    });
  }

  function layoutArc() {
    if (!releaseArc || !releaseState.cards.length) return;

    const total = releaseState.cards.length;
    const stageWidth = releaseArc.clientWidth || 900;
    const spread = Math.max(122, Math.min(224, stageWidth * 0.255));

    releaseState.cards.forEach((card, index) => {
      let offset = index - releaseState.active;
      if (total > 1) {
        if (offset > total / 2) offset -= total;
        if (offset < -total / 2) offset += total;
      }

      const depth = Math.abs(offset);
      const cappedDepth = Math.min(depth, 3);
      const direction = offset === 0 ? 0 : Math.sign(offset);
      const distance = cappedDepth === 0 ? 0 : spread * (1 + (cappedDepth - 1) * 0.74);
      const x = direction * distance;
      const y = cappedDepth * 13;
      const scale = Math.max(0.61, 1 - cappedDepth * 0.145);
      const rotation = -direction * Math.min(cappedDepth, 2) * 8;
      const opacity = depth === 0 ? 1 : depth === 1 ? 0.72 : depth === 2 ? 0.3 : 0;
      const isActive = depth === 0;

      card.style.setProperty('--x', `${x.toFixed(1)}px`);
      card.style.setProperty('--y', `${y}px`);
      card.style.setProperty('--scale', scale.toFixed(3));
      card.style.setProperty('--rot', `${rotation}deg`);
      card.style.setProperty('--opacity', opacity.toFixed(2));
      card.style.zIndex = String(isActive ? 40 : 30 - cappedDepth);
      card.style.pointerEvents = depth > 2 ? 'none' : '';
      card.classList.toggle('is-active', isActive);
      card.tabIndex = isActive ? 0 : -1;
      card.setAttribute('aria-current', isActive ? 'true' : 'false');

      const link = $('.arc-card-link', card);
      if (link) link.tabIndex = isActive ? 0 : -1;

      if (depth > 2) card.setAttribute('aria-hidden', 'true');
      else card.removeAttribute('aria-hidden');
    });
  }

  function updateArcMeta() {
    const total = releaseState.items.length;
    if (arcCurrent) arcCurrent.textContent = String(releaseState.active + 1).padStart(2, '0');
    if (arcTotal) arcTotal.textContent = String(total).padStart(2, '0');
    if (arcPrev) arcPrev.disabled = total < 2;
    if (arcNext) arcNext.disabled = total < 2;

    if (!arcStatus) return;
    if (!total) {
      arcStatus.textContent = 'The signed release archive is unavailable.';
      return;
    }
    const release = releaseState.items[releaseState.active];
    arcStatus.textContent = `Showing Docmac ${versionLabel(release)}, release ${releaseState.active + 1} of ${total}.`;
  }

  function selectRelease(index) {
    const total = releaseState.items.length;
    if (!total) return;

    releaseState.active = ((index % total) + total) % total;
    const release = releaseState.items[releaseState.active];

    updateHud(release);
    updateTabState(release.versionName);
    layoutArc();
    updateArcMeta();
  }

  function renderReleaseTabs(releases) {
    if (!releaseTabsRoot) return;
    releaseTabsRoot.replaceChildren();

    if (!releases.length) {
      const empty = document.createElement('p');
      empty.className = 'release-tabs-empty';
      empty.textContent = 'The release archive could not be read.';
      releaseTabsRoot.append(empty);
      return;
    }

    releases.forEach((release) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'release-tab';
      tab.dataset.releaseTab = '';
      tab.dataset.version = release.versionName;
      tab.dataset.size = formatSize(release);
      tab.dataset.date = formatDate(release.publishedAt);
      tab.dataset.link = releasePageHref(release);

      const version = document.createElement('strong');
      version.textContent = versionLabel(release);
      const size = document.createElement('span');
      size.textContent = formatSize(release);

      tab.append(version, size);
      releaseTabsRoot.append(tab);
    });

    updateTabState(releaseState.items[releaseState.active]?.versionName);
  }

  function renderReleaseArc(releases) {
    if (!releaseArc) return;
    releaseArc.replaceChildren();
    releaseState.cards = [];

    if (!releases.length) {
      const error = document.createElement('p');
      error.className = 'arc-error';
      error.append(document.createTextNode('The signed release archive could not be read. '));
      const link = document.createElement('a');
      link.href = 'https://github.com/jackbarisere8/DOCMAC/releases';
      link.textContent = 'Browse every build on GitHub';
      error.append(link);
      releaseArc.append(error);
      updateArcMeta();
      return;
    }

    releases.forEach((release, index) => {
      const card = document.createElement('article');
      card.className = 'arc-card';
      if (release.yanked) card.classList.add('is-yanked');
      card.dataset.version = release.versionName;
      card.tabIndex = -1;
      card.setAttribute('role', 'group');
      card.setAttribute('aria-label', `Docmac ${versionLabel(release)}`);

      const head = document.createElement('header');
      head.className = 'arc-card-head';

      const badge = document.createElement('span');
      badge.className = 'arc-badge';
      badge.textContent = releaseBadge(release, index);

      const signed = document.createElement('span');
      signed.className = 'arc-signed';
      signed.append(createIcon('i-shield-check'), document.createTextNode('Signed'));

      head.append(badge, signed);

      const title = document.createElement('div');
      const version = document.createElement('strong');
      version.className = 'arc-version';
      version.textContent = versionLabel(release);
      const caption = document.createElement('span');
      caption.className = 'arc-caption';
      caption.textContent = `${formatDate(release.publishedAt)} · ${formatSize(release)}`;
      title.append(version, caption);

      const art = document.createElement('div');
      art.className = 'arc-art';
      const image = document.createElement('img');
      image.src = ARC_IMAGES[index % ARC_IMAGES.length];
      image.alt = '';
      image.width = 1400;
      image.height = 1100;
      image.loading = 'lazy';
      image.decoding = 'async';
      const artMeta = document.createElement('div');
      artMeta.className = 'arc-art-meta';
      const android = document.createElement('span');
      android.textContent = `Android ${release.minAndroid || '7.0'}+`;
      const checksum = document.createElement('span');
      checksum.textContent = release.sha256 ? 'SHA-256' : 'Checksum pending';
      artMeta.append(android, checksum);
      art.append(image, artMeta);

      const note = document.createElement('p');
      note.className = 'arc-note';
      note.textContent = releaseSummary(release);

      const foot = document.createElement('footer');
      foot.className = 'arc-card-foot';
      const link = document.createElement('a');
      link.className = 'arc-card-link';
      link.href = releasePageHref(release);
      link.append(document.createTextNode('Release details'));
      const arrow = document.createElement('span');
      arrow.className = 'arc-card-arrow';
      arrow.append(createIcon('i-arrow-right'));
      link.append(arrow);
      foot.append(link);

      card.append(head, title, art, note, foot);
      card.addEventListener('click', (event) => {
        if (performance.now() < suppressArcClickUntil) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const linkTarget = event.target.closest('a');
        if (linkTarget) {
          if (card.classList.contains('is-active')) return;
          event.preventDefault();
        }
        selectRelease(index);
      });

      releaseArc.append(card);
      releaseState.cards.push(card);
    });

    updateArcMeta();
  }

  function renderArcError() {
    if (!releaseArc) return;
    releaseState.cards = [];
    releaseArc.replaceChildren();
    const error = document.createElement('p');
    error.className = 'arc-error';
    error.append(document.createTextNode('The signed release archive could not load. '));
    const link = document.createElement('a');
    link.href = 'https://github.com/jackbarisere8/DOCMAC/releases';
    link.textContent = 'Browse every build on GitHub';
    error.append(link);
    releaseArc.append(error);
    updateArcMeta();
  }

  function syncReleaseCount(total) {
    if (!total) return;
    $$('[data-release-count]').forEach((element) => {
      element.textContent = String(total);
    });

    const counter = $('[data-count-release]');
    if (counter) {
      counter.dataset.count = String(total);
      if (counter.dataset.counted === '1') counter.textContent = String(total);
    }
  }

  function initReleasePreview() {
    if (releaseTabsRoot) {
      releaseTabsRoot.addEventListener('click', (event) => {
        const tab = event.target.closest('[data-release-tab]');
        if (!tab) return;

        const index = releaseState.items.findIndex(
          (release) => release.versionName === tab.dataset.version,
        );
        if (index >= 0) {
          selectRelease(index);
        } else {
          updateHudFromTab(tab);
          updateTabState(tab.dataset.version);
        }
      });
    }

    if (releaseArc) {
      let drag = null;

      releaseArc.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (event.target.closest('a, button')) return;
        drag = { x: event.clientX, y: event.clientY, id: event.pointerId };
        releaseArc.classList.remove('is-dragging');
      });

      releaseArc.addEventListener('pointermove', (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
          releaseArc.classList.add('is-dragging');
        }
      });

      const endDrag = (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        const swiped = Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy);
        drag = null;
        releaseArc.classList.remove('is-dragging');
        if (!swiped) return;
        suppressArcClickUntil = performance.now() + 420;
        selectRelease(releaseState.active + (dx < 0 ? 1 : -1));
      };

      releaseArc.addEventListener('pointerup', endDrag);
      releaseArc.addEventListener('pointercancel', () => {
        drag = null;
        releaseArc.classList.remove('is-dragging');
      });

      releaseArc.addEventListener(
        'click',
        (event) => {
          if (performance.now() > suppressArcClickUntil) return;
          event.preventDefault();
          event.stopPropagation();
          suppressArcClickUntil = 0;
        },
        true,
      );

      releaseArc.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        selectRelease(releaseState.active + (event.key === 'ArrowLeft' ? -1 : 1));
        releaseState.cards[releaseState.active]?.focus({ preventScroll: true });
      });

      let resizeFrame = 0;
      window.addEventListener(
        'resize',
        () => {
          window.cancelAnimationFrame(resizeFrame);
          resizeFrame = window.requestAnimationFrame(layoutArc);
        },
        { passive: true },
      );
    }

    arcPrev?.addEventListener('click', () => selectRelease(releaseState.active - 1));
    arcNext?.addEventListener('click', () => selectRelease(releaseState.active + 1));
  }

  function setCopyButton(button, value) {
    if (!button) return;
    if (!value) {
      button.disabled = true;
      button.dataset.copy = '';
      return;
    }
    button.disabled = false;
    button.dataset.copy = value;
  }

  function buildReleaseItem(release, isLatest = false) {
    const article = document.createElement('article');
    article.className = 'release-item';
    if (release.yanked) article.classList.add('is-yanked');

    const head = document.createElement('div');
    head.className = 'release-item-head';

    const title = document.createElement('div');
    title.className = 'release-item-title';
    const version = document.createElement('strong');
    version.textContent = versionLabel(release);
    title.append(version);

    const badgeText = release.yanked ? 'Yanked' : release.channel === 'beta' ? 'Beta' : isLatest ? 'Latest' : '';
    if (badgeText) {
      const badge = document.createElement('span');
      badge.className = `release-badge${release.yanked ? ' release-badge-warn' : ''}`;
      badge.textContent = badgeText;
      title.append(badge);
    }

    const download = document.createElement('a');
    download.className = 'release-item-download';
    const downloadUrl = safeHttpsUrl(release.downloadUrl);
    download.href = downloadUrl || '#download';
    if (!downloadUrl) download.setAttribute('aria-disabled', 'true');
    download.setAttribute('aria-label', `Download Docmac ${versionLabel(release)} APK`);
    download.innerHTML = 'Download <span aria-hidden="true">↓</span>';

    head.append(title, download);

    const meta = document.createElement('p');
    meta.className = 'release-item-meta';
    meta.textContent = `${formatDate(release.publishedAt)} · ${formatSize(release)} · Android ${release.minAndroid || '7.0'}+`;

    const notes = document.createElement('details');
    notes.className = 'release-notes';
    const summary = document.createElement('summary');
    summary.innerHTML = 'Release notes <span class="notes-toggle" aria-hidden="true">+</span>';
    const notesBody = document.createElement('p');
    notesBody.className = 'release-notes-body';
    notesBody.textContent = release.releaseNotes;
    notes.append(summary, notesBody);

    const checksum = document.createElement('div');
    checksum.className = 'release-checksum';
    const checksumLabel = document.createElement('span');
    checksumLabel.textContent = 'SHA-256';
    const checksumValue = document.createElement('code');
    checksumValue.textContent = release.sha256 || 'Not published';
    if (release.sha256) checksumValue.title = release.sha256;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'copy-button';
    copy.textContent = 'Copy';
    setCopyButton(copy, release.sha256);
    checksum.append(checksumLabel, checksumValue, copy);

    const links = document.createElement('p');
    links.className = 'release-item-links';
    const pageLink = document.createElement('a');
    pageLink.href = safeHttpsUrl(release.releaseUrl) || 'https://github.com/jackbarisere8/DOCMAC/releases';
    pageLink.rel = 'noopener';
    pageLink.textContent = 'Release page';
    links.append(pageLink);
    if (release.yanked) {
      const warning = document.createElement('span');
      warning.className = 'release-item-warning';
      warning.textContent = 'This build was withdrawn. Choose the latest release instead.';
      links.append(warning);
    }

    article.append(head, meta, notes, checksum, links);
    return article;
  }

  function renderManifest(manifest) {
    const latest = manifest.latest;
    if (!latest) throw new Error('The release manifest has no latest release.');

    const releases = (Array.isArray(manifest.releases) ? manifest.releases : []).filter(
      (release) => release && release.versionName,
    );
    if (!releases.some((release) => release.tag === latest.tag)) releases.unshift(latest);

    releaseState.items = releases;
    releaseState.active = Math.max(
      0,
      releases.findIndex((release) => release.tag === latest.tag),
    );

    setText('[data-release-version]', versionLabel(latest));
    setText('[data-release-size]', formatSize(latest));
    setText('[data-release-min-android]', `${latest.minAndroid || '7.0'}+`);
    setText('[data-release-android-long]', `Android ${latest.minAndroid || '7.0'} and newer`);
    setText('[data-release-date]', formatDate(latest.publishedAt));

    if (downloadButton) {
      const downloadUrl = safeHttpsUrl(latest.downloadUrl);
      if (downloadUrl) downloadButton.href = downloadUrl;
      downloadButton.setAttribute('aria-label', `Download Docmac ${versionLabel(latest)} APK`);
    }

    const latestNotes = $('#latest-notes-body');
    if (latestNotes) latestNotes.textContent = latest.releaseNotes;

    const sha = $('#latest-sha256');
    if (sha) {
      sha.textContent = latest.sha256 || 'Not published';
      if (latest.sha256) sha.title = latest.sha256;
    }
    const cert = $('#latest-cert');
    if (cert) {
      cert.textContent = latest.signatureSha256 || 'Not published';
      if (latest.signatureSha256) cert.title = latest.signatureSha256;
    }

    setCopyButton($('[data-copy-target="latest-sha256"]'), latest.sha256);
    setCopyButton($('[data-copy-target="latest-cert"]'), latest.signatureSha256);

    const releasePage = $('#latest-release-page');
    if (releasePage) releasePage.href = safeHttpsUrl(latest.releaseUrl) || 'https://github.com/jackbarisere8/DOCMAC/releases';

    const older = releases.filter((release) => release.tag !== latest.tag);

    if (previousReleases) {
      previousReleases.replaceChildren();
      older.forEach((release) => previousReleases.append(buildReleaseItem(release)));
    }

    if (releaseHistoryToggle) {
      if (!older.length) {
        releaseHistoryToggle.hidden = true;
      } else {
        releaseHistoryToggle.hidden = false;
        releaseHistoryToggle.dataset.count = String(older.length);
        releaseHistoryToggle.innerHTML = `See previous releases (${older.length}) <span aria-hidden="true">+</span>`;
      }
    }

    syncReleaseCount(releases.length);
    renderReleaseTabs(releases);
    renderReleaseArc(releases);
    selectRelease(releaseState.active);

    if (releaseStatus) releaseStatus.textContent = '';
  }

  async function loadReleases() {
    if (!downloadButton && !releaseHistoryToggle && !releaseTabsRoot && !releaseArc) return;

    try {
      const response = await fetch(RELEASE_ENDPOINT, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`Release manifest returned ${response.status}`);
      const manifest = await response.json();
      renderManifest(manifest);
    } catch (error) {
      console.error('Could not load releases.json', error);
      if (releaseStatus) {
        releaseStatus.innerHTML = '';
        const message = document.createElement('span');
        message.textContent =
          'The release list could not load. The download button still points to the latest official APK. ';
        const link = document.createElement('a');
        link.href = 'https://github.com/jackbarisere8/DOCMAC/releases';
        link.textContent = 'View every version on GitHub';
        releaseStatus.append(message, link);
      }
      if (releaseHistoryToggle) releaseHistoryToggle.hidden = true;
      const sha = $('#latest-sha256');
      const cert = $('#latest-cert');
      if (sha) sha.textContent = 'Unavailable';
      if (cert) cert.textContent = 'Unavailable';
      renderArcError();
    }
  }

  if (releaseHistoryToggle && previousReleases) {
    releaseHistoryToggle.addEventListener('click', () => {
      const expanded = releaseHistoryToggle.getAttribute('aria-expanded') === 'true';
      releaseHistoryToggle.setAttribute('aria-expanded', String(!expanded));
      previousReleases.hidden = expanded;
      const count = releaseHistoryToggle.dataset.count || '';
      const suffix = count ? ` (${count})` : '';
      releaseHistoryToggle.innerHTML = expanded
        ? `See previous releases${suffix} <span aria-hidden="true">+</span>`
        : `Hide previous releases${suffix} <span aria-hidden="true">−</span>`;
    });
  }

  if (downloadButton) {
    downloadButton.addEventListener('click', () => {
      if (releaseStatus) {
        releaseStatus.textContent = 'Your download should begin. Verify the SHA-256 below before installing.';
      }
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Android detection & QR code                                            */
  /* ---------------------------------------------------------------------- */

  const userAgent = navigator.userAgent || '';
  const isAndroid = /Android/i.test(userAgent);
  const deviceHint = $('#device-hint');
  const qrCard = $('#qr-card');

  if (deviceHint) {
    if (isAndroid) {
      deviceHint.classList.add('is-android');
      const check = createIcon('i-check', 'icon icon-sm');
      const copy = document.createElement('span');
      copy.textContent = 'Android detected. Tap Download above.';
      deviceHint.replaceChildren(check, copy);
    } else {
      deviceHint.textContent = 'Docmac runs on Android 7.0+. Scan the QR code with an Android phone, or transfer the APK.';
    }
  }

  if (qrCard) {
    // Show QR card on desktop / non-Android devices, hide on Android phones
    qrCard.hidden = isAndroid;
  }

  initReleasePreview();
  loadReleases();

  /* ---------------------------------------------------------------------- */
  /* Copy to clipboard                                                       */
  /* ---------------------------------------------------------------------- */

  const copyStatus = document.createElement('p');
  copyStatus.className = 'sr-only';
  copyStatus.setAttribute('role', 'status');
  copyStatus.setAttribute('aria-live', 'polite');
  document.body.append(copyStatus);

  async function copyText(value) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('Copy command was rejected.');
  }

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('.copy-button');
    if (!button || button.disabled) return;

    const value = button.dataset.copy;
    if (!value) return;

    const original = button.dataset.originalLabel || button.textContent;
    button.dataset.originalLabel = original;

    try {
      await copyText(value);
      button.textContent = 'Copied';
      button.classList.add('is-copied');
      copyStatus.textContent = 'Value copied to clipboard.';
    } catch (error) {
      button.textContent = 'Press Ctrl+C';
      const target = button.dataset.copyTarget ? document.getElementById(button.dataset.copyTarget) : null;
      if (target) {
        const range = document.createRange();
        range.selectNodeContents(target);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      copyStatus.textContent = 'Copy failed. The value is selected; press Ctrl+C or Command+C.';
    }

    window.setTimeout(() => {
      button.textContent = original;
      button.classList.remove('is-copied');
    }, 2400);
  });

  /* ---------------------------------------------------------------------- */
  /* Feedback form (mailto only; the static site has no feedback intake)     */
  /* ---------------------------------------------------------------------- */

  const feedbackForm = $('#feedback-form');
  const feedbackStatus = $('#feedback-status');

  if (feedbackForm) {
    feedbackForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!feedbackForm.reportValidity()) return;

      const form = new FormData(feedbackForm);
      const name = String(form.get('name') || '').trim();
      const email = String(form.get('email') || '').trim();
      const topic = String(form.get('topic') || 'Website feedback');
      const message = String(form.get('message') || '').trim();
      if (!message) return;

      const subject = `Docmac feedback: ${topic}`;
      const body = `Name: ${name || 'Not provided'}\nEmail: ${email || 'Not provided'}\nTopic: ${topic}\n\nFeedback:\n${message}`;
      const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

      if (feedbackStatus) {
        feedbackStatus.hidden = false;
        feedbackStatus.replaceChildren();
        const text = document.createElement('span');
        text.textContent = 'Opening your email app with this message. If it does not open, use this link: ';
        const link = document.createElement('a');
        link.href = mailto;
        link.textContent = 'open the feedback email';
        const note = document.createElement('span');
        note.textContent = ' Your message is not sent to or stored on this website.';
        feedbackStatus.append(text, link, note);
      }

      window.location.href = mailto;
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Footer year and deep links                                              */
  /* ---------------------------------------------------------------------- */

  setText('[data-year]', String(new Date().getFullYear()));

  if (window.location.hash) {
    const target = document.getElementById(window.location.hash.slice(1));
    if (target) {
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      requestAnimationFrame(() => target.focus({ preventScroll: true }));
    }
  }
})();
