/* Interactivity for the static site. Operates only on pre-rendered DOM.
 * No fetch, no markdown parsing, no innerHTML rebuild.
 * Guards every lookup so it runs harmlessly on per-model pages too. */
(function () {
    'use strict';

    // === THEME TOGGLE === (present on every page)
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
        const themeIcon = themeBtn.querySelector('.theme-icon');
        const getTheme = () =>
            document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
        const setTheme = (t) => {
            if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
            else document.documentElement.removeAttribute('data-theme');
            localStorage.setItem('theme', t);
            if (themeIcon) themeIcon.textContent = t === 'light' ? '\u{1F319}' : '☀️';
        };
        if (themeIcon) themeIcon.textContent = getTheme() === 'light' ? '\u{1F319}' : '☀️';
        themeBtn.addEventListener('click', () => setTheme(getTheme() === 'dark' ? 'light' : 'dark'));
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (!localStorage.getItem('theme')) setTheme(e.matches ? 'dark' : 'light');
        });
    }

    // === SHARE LINKS === (present on every page)
    // Share the current page (canonical if set), so model pages share their own URL.
    const canonical = document.querySelector('link[rel="canonical"]');
    const pageUrl = (canonical && canonical.href) || window.location.href;
    const shareCountEl = document.getElementById('model-count');
    const modelCount = (shareCountEl && shareCountEl.textContent) || '27';
    const shareText = `I asked ${modelCount}+ LLMs "Tell me something I don't know." Most of them said jellyfish \u{1FAB4}`;
    const enc = encodeURIComponent(shareText);
    const encUrl = encodeURIComponent(pageUrl);
    const setHref = (id, href) => { const el = document.getElementById(id); if (el) el.href = href; };
    setHref('share-x', `https://twitter.com/intent/tweet?url=${encUrl}&text=${enc}`);
    setHref('share-facebook', `https://www.facebook.com/sharer/sharer.php?u=${encUrl}`);
    setHref('share-reddit', `https://reddit.com/submit?url=${encUrl}&title=${enc}`);
    setHref('share-linkedin', `https://www.linkedin.com/sharing/share-offsite/?url=${encUrl}`);
    const copyBtn = document.getElementById('share-copy');
    if (copyBtn) {
        copyBtn.addEventListener('click', (e) => {
            e.preventDefault();
            navigator.clipboard.writeText(pageUrl).then(() => {
                const el = e.currentTarget;
                el.textContent = 'Copied!';
                setTimeout(() => { el.textContent = 'Copy Link'; }, 2000);
            });
        });
    }

    // === RUN-TAB SWITCHING === (cards on any page)
    function switchRun(card, runIdx) {
        card.querySelectorAll('.response-tab').forEach((t) => t.classList.remove('active'));
        const tab = card.querySelector(`.response-tab[data-run="${runIdx}"]`);
        if (tab) tab.classList.add('active');
        card.querySelectorAll('[data-run]').forEach((el) => {
            if (el.classList.contains('response-tab')) return;
            el.classList.toggle('hidden', el.dataset.run !== String(runIdx));
        });
    }

    const grid = document.getElementById('model-grid');

    // === HOMEPAGE-ONLY FEATURES ===
    if (grid) {
        const visibleCountEl = document.getElementById('visible-count');
        const topicBarsEl = document.getElementById('topic-bars');

        // Scroll-in animation
        const observer = new IntersectionObserver((entries) => {
            entries.filter((e) => e.isIntersecting).forEach((entry, i) => {
                setTimeout(() => entry.target.classList.add('visible'), i * 60);
                observer.unobserve(entry.target);
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
        document.querySelectorAll('.model-card').forEach((c) => observer.observe(c));

        // Hero "another one"
        const heroText = document.getElementById('hero-text');
        const heroModel = document.getElementById('hero-model');
        const heroRefresh = document.getElementById('hero-refresh');
        const heroCandidates = Array.isArray(window.__HERO) ? window.__HERO : [];
        if (heroText && heroRefresh && heroCandidates.length) {
            heroText.style.transition = 'opacity 0.2s ease';
            const showRandom = () => {
                const pick = heroCandidates[Math.floor(Math.random() * heroCandidates.length)];
                heroText.style.opacity = '0';
                setTimeout(() => {
                    heroText.textContent = pick.snippet;
                    if (heroModel) heroModel.textContent = `— ${pick.model}, Run ${pick.run + 1}`;
                    heroText.style.opacity = '1';
                }, 200);
            };
            heroRefresh.addEventListener('click', showRandom);
        }

        // Filter + topic state
        const filterPills = document.querySelectorAll('.filter-pill[data-filter]');
        let activeLicenseFilter = 'all';
        let activeTopicFilter = null;

        function switchToFirstRunWithTopic(card, topic) {
            let targetRun = null;
            card.querySelectorAll('.response-meta[data-run]').forEach((meta) => {
                if (targetRun !== null) return;
                if (meta.querySelector(`.topic-tag[data-topic="${topic}"]`)) targetRun = meta.dataset.run;
            });
            if (targetRun === null) return;
            const activeTab = card.querySelector('.response-tab.active');
            if (activeTab && activeTab.dataset.run === targetRun) return;
            switchRun(card, targetRun);
        }

        function updateFilter() {
            filterPills.forEach((p) => p.classList.toggle('active', p.dataset.filter === activeLicenseFilter));
            let visible = 0;
            document.querySelectorAll('.model-card').forEach((card) => {
                const licenseMatch = activeLicenseFilter === 'all' || card.dataset.license === activeLicenseFilter;
                const topicMatch = !activeTopicFilter || (card.dataset.topics || '').split(',').includes(activeTopicFilter);
                const show = licenseMatch && topicMatch;
                card.style.display = show ? '' : 'none';
                if (show && activeTopicFilter) switchToFirstRunWithTopic(card, activeTopicFilter);
                if (show) visible++;
            });
            if (visibleCountEl) visibleCountEl.textContent = `${visible} model${visible !== 1 ? 's' : ''}`;
            document.querySelectorAll('.topic-bar-row[data-topic]').forEach((row) => {
                row.classList.toggle('active', row.dataset.topic === activeTopicFilter);
            });
            document.querySelectorAll('.topic-tag[data-topic]').forEach((tag) => {
                tag.classList.toggle('active', tag.dataset.topic === activeTopicFilter);
            });
        }

        grid.addEventListener('click', (e) => {
            const tag = e.target.closest('.topic-tag[data-topic]');
            if (tag) {
                activeTopicFilter = activeTopicFilter === tag.dataset.topic ? null : tag.dataset.topic;
                updateFilter();
                return;
            }
            const tab = e.target.closest('.response-tab');
            if (!tab) return;
            switchRun(tab.closest('.model-card'), tab.dataset.run);
        });

        if (topicBarsEl) {
            topicBarsEl.addEventListener('click', (e) => {
                const row = e.target.closest('.topic-bar-row[data-topic]');
                if (!row) return;
                activeTopicFilter = activeTopicFilter === row.dataset.topic ? null : row.dataset.topic;
                updateFilter();
            });
        }

        filterPills.forEach((pill) => pill.addEventListener('click', () => {
            activeLicenseFilter = pill.dataset.filter;
            updateFilter();
        }));
        updateFilter();

        // Sort
        const sortPills = document.querySelectorAll('.filter-pill[data-sort]');
        let activeSort = 'default';
        function applySort() {
            sortPills.forEach((p) => p.classList.toggle('active', p.dataset.sort === activeSort));
            const cards = [...document.querySelectorAll('.model-card')];
            cards.sort((a, b) => {
                switch (activeSort) {
                    case 'name':
                        return a.querySelector('.model-name').textContent.localeCompare(b.querySelector('.model-name').textContent);
                    case 'provider':
                        return a.querySelector('.model-provider').textContent.localeCompare(b.querySelector('.model-provider').textContent)
                            || a.querySelector('.model-name').textContent.localeCompare(b.querySelector('.model-name').textContent);
                    case 'shortest':
                        return parseInt(a.dataset.sortTokens) - parseInt(b.dataset.sortTokens);
                    case 'original':
                        return parseInt(b.dataset.originality) - parseInt(a.dataset.originality)
                            || a.querySelector('.model-name').textContent.localeCompare(b.querySelector('.model-name').textContent);
                    default:
                        return parseInt(b.dataset.sortReleased) - parseInt(a.dataset.sortReleased)
                            || a.querySelector('.model-name').textContent.localeCompare(b.querySelector('.model-name').textContent)
                            || parseInt(a.dataset.index) - parseInt(b.dataset.index);
                }
            });
            cards.forEach((card) => grid.appendChild(card));
        }
        sortPills.forEach((pill) => pill.addEventListener('click', () => {
            activeSort = pill.dataset.sort;
            applySort();
        }));
        applySort();

        // Surprise me
        const surpriseBtn = document.getElementById('surprise-btn');
        if (surpriseBtn) {
            surpriseBtn.addEventListener('click', () => {
                const visible = [...document.querySelectorAll('.model-card')].filter((c) => c.style.display !== 'none');
                if (!visible.length) return;
                const pick = visible[Math.floor(Math.random() * visible.length)];
                pick.scrollIntoView({ behavior: 'smooth', block: 'center' });
                pick.classList.remove('surprise-highlight');
                void pick.offsetWidth;
                pick.classList.add('surprise-highlight');
                pick.addEventListener('animationend', () => pick.classList.remove('surprise-highlight'), { once: true });
            });
        }
    } else {
        // Per-model page: just wire tab switching on any cards present.
        document.querySelectorAll('.model-card').forEach((card) => {
            card.addEventListener('click', (e) => {
                const tab = e.target.closest('.response-tab');
                if (tab) switchRun(card, tab.dataset.run);
            });
        });
    }
})();
