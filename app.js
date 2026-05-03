/* ============================================================ */
/*  品川区 子育てサービスまとめ - app.js                        */
/* ============================================================ */
(() => {
  'use strict';

  const state = {
    services: [],
    categoryDefs: [],
    activeCategory: null,
  };

  const els = {};

  // ====== Util ======
  const $ = (id) => document.getElementById(id);

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v);
      }
    }
    if (children) {
      const arr = Array.isArray(children) ? children : [children];
      arr.forEach(c => {
        if (c == null) return;
        e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return e;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // ====== ルーティング(ハッシュベース) ======
  const VIEWS = { '/': 'view-home', '/category': 'view-category', '/date': 'view-date' };

  function parseHash() {
    return location.hash.replace(/^#/, '') || '/';
  }

  function navigate(path) {
    const targetId = VIEWS[path] || 'view-home';
    document.querySelectorAll('.view').forEach(v => { v.hidden = (v.id !== targetId); });
    els.backButton.hidden = (path === '/');
    if (path === '/category' && !state.activeCategory) {
      setActiveCategory(state.categoryDefs[0]);
    }
    window.scrollTo(0, 0);
  }

  // ====== データ読込 ======
  async function loadServices() {
    const res = await fetch('services.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('services.json の読込に失敗しました');
    const data = await res.json();
    state.services = data.services;
    state.categoryDefs = data.categories;
  }

  // ====== カテゴリビュー ======
  function setActiveCategory(cat) {
    state.activeCategory = cat;
    renderCategoryTabs();
    renderCategoryCards();
  }

  function renderCategoryTabs() {
    clear(els.categoryTabs);
    state.categoryDefs.forEach(cat => {
      const tab = el('button', {
        class: 'category-tab',
        type: 'button',
        role: 'tab',
        'aria-selected': cat === state.activeCategory ? 'true' : 'false',
        onclick: () => setActiveCategory(cat),
      }, cat);
      els.categoryTabs.appendChild(tab);
    });
  }

  function renderCategoryCards() {
    const cat = state.activeCategory;
    const list = cat === '全て'
      ? state.services
      : state.services.filter(s => s.categories.includes(cat));
    clear(els.categoryCardList);
    if (list.length === 0) {
      els.categoryCardList.appendChild(el('p', { class: 'result-empty' }, '該当するサービスはありません。'));
      return;
    }
    list.forEach(s => els.categoryCardList.appendChild(makeCard(s)));
  }

  // 「もらえるもの」(現金・品物・給付金)があるか
  // 「自己負担」(助成・補助あり)かどうか
  const SUBSIDY_RE = /助成|補助|割|給付|手当/;
  function hasGiftBenefit(svc) {
    return !!svc.benefit;
  }
  function isSubsidySelfPayment(svc) {
    return !!(svc.self_payment && SUBSIDY_RE.test(svc.self_payment));
  }

  // ====== カード生成 ======
  function makeCard(svc, opts) {
    opts = opts || {};
    const card = el('button', { class: 'card', type: 'button', onclick: () => openModal(svc) });
    card.appendChild(el('div', { class: 'card-name' }, svc.name));

    const targetRow = el('div', { class: 'card-meta' });
    targetRow.appendChild(el('span', { class: 'card-meta-label' }, '対象'));
    targetRow.appendChild(document.createTextNode(svc.target || '-'));
    card.appendChild(targetRow);

    const timingRow = el('div', { class: 'card-meta' });
    timingRow.appendChild(el('span', { class: 'card-meta-label' }, '時期'));
    timingRow.appendChild(document.createTextNode(svc.timing_text || '-'));
    card.appendChild(timingRow);

    const hasGift = hasGiftBenefit(svc);
    const isSubsidy = isSubsidySelfPayment(svc);

    // サマリー: もらえるもの(現金・品物・給付金) は赤ハイライト。
    // 助成・補助系のサービスは self_payment と内容がほぼ同じなので、サマリーは省略し自己負担側で表示。
    const summaryText = svc.benefit_summary || (svc.description ? svc.description.slice(0, 60) : '');
    if (summaryText) {
      if (hasGift) {
        card.appendChild(el('div', { class: 'card-summary card-summary--benefit' }, summaryText));
      } else if (!isSubsidy) {
        card.appendChild(el('div', { class: 'card-summary' }, summaryText));
      }
    }

    // 自己負担: 助成・補助ありは青ハイライトで強調、それ以外は小さなピル表示
    if (svc.self_payment) {
      const cls = isSubsidy ? 'card-payment-highlight' : 'card-payment';
      card.appendChild(el('div', { class: cls }, '自己負担: ' + svc.self_payment));
    }
    if (opts.statusText) {
      card.appendChild(el('div', { class: 'card-status' }, opts.statusText));
    }
    return card;
  }

  // ====== 日付ビュー ======
  function setupDateForm() {
    els.dateForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const dateType = els.dateForm.querySelector('input[name="dateType"]:checked').value;
      const dateValue = els.dateInput.value;
      if (!dateValue) return;
      runDateSearch(dateType, dateValue);
    });
  }

  /**
   * 日付検索の中核ロジック
   *  - 出産日(birth)を 0 日とする日数軸で判定
   *  - 出産予定日入力時は (今日 - 出産予定日) を dayFromBirth とする(出産前は負)
   *  - 出産日入力時は (今日 - 出産日) = 生後日数
   */
  function runDateSearch(type, dateStr) {
    const inputDate = parseDateLocal(dateStr);
    const today = startOfToday();
    const dayFromBirth = Math.floor((today - inputDate) / 86400000);

    let summary;
    if (type === 'due') {
      const daysToBirth = -dayFromBirth;
      const currentWeekFloat = 40 - daysToBirth / 7;
      const weeks = Math.floor(currentWeekFloat);
      const days = Math.floor((currentWeekFloat - weeks) * 7);
      if (daysToBirth > 0) {
        summary = `出産予定日: ${formatDate(inputDate)} ／ 現在 妊娠 ${weeks}週${days}日(出産まで残り ${daysToBirth} 日)`;
      } else if (daysToBirth === 0) {
        summary = `出産予定日: ${formatDate(inputDate)} ／ 本日が出産予定日です`;
      } else {
        summary = `出産予定日: ${formatDate(inputDate)} ／ 予定日から ${-daysToBirth} 日経過`;
      }
    } else {
      summary = `出産日: ${formatDate(inputDate)} ／ 生後 ${dayFromBirth} 日`;
      if (dayFromBirth < 0) {
        summary = `出産日: ${formatDate(inputDate)} ／ 出産まで残り ${-dayFromBirth} 日`;
      }
    }
    els.dateSummary.textContent = summary;

    const now = [], soon = [], long = [];
    const SOON_THRESHOLD = 30;
    const LONG_THRESHOLD = 1095; // 3年以上の利用期間 = 「継続して使えるもの」

    state.services.forEach(svc => {
      const from = svc.available_from_days;
      const to = svc.available_to_days;
      const span = to - Math.max(from, 0);
      const isLong = span >= LONG_THRESHOLD;

      if (dayFromBirth > to) {
        // 終了済みは表示しない
        return;
      }

      if (isLong) {
        // 長期サービス: 終了日が未来であれば常に長期セクション
        if (dayFromBirth >= from) {
          long.push({ svc, statusText: '継続して利用可' });
        } else {
          long.push({ svc, statusText: `あと ${from - dayFromBirth} 日で開始` });
        }
      } else if (dayFromBirth >= from) {
        // いま利用可能(短期)
        const remaining = to - dayFromBirth;
        now.push({ svc, statusText: `残り ${remaining} 日` });
      } else {
        // 開始前(短期)
        const days = from - dayFromBirth;
        if (days <= SOON_THRESHOLD) {
          soon.push({ svc, statusText: `あと ${days} 日で開始` });
        }
      }
    });

    renderResultSection(els.cardListNow, now);
    renderResultSection(els.cardListSoon, soon);
    renderResultSection(els.cardListLong, long);
    els.dateResult.hidden = false;
  }

  function renderResultSection(container, items) {
    clear(container);
    if (items.length === 0) {
      container.appendChild(el('p', { class: 'result-empty' }, '該当するサービスはありません。'));
      return;
    }
    items.forEach(item => container.appendChild(makeCard(item.svc, { statusText: item.statusText })));
  }

  // ====== 日付ヘルパー ======
  function parseDateLocal(s) {
    // YYYY-MM-DD をローカルタイムで Date に
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function startOfToday() {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate());
  }
  function formatDate(d) {
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }

  // ====== モーダル ======
  function openModal(svc) {
    els.modalTitle.textContent = svc.name;

    clear(els.modalTags);
    svc.categories.forEach(c => {
      els.modalTags.appendChild(el('span', { class: 'modal-tag' }, c));
    });

    clear(els.modalBody);
    addRow('対象', svc.target);
    addRow('時期', svc.timing_text);
    addRow('予約方法', svc.reservation);
    addRow('場所', svc.location);
    addRow('自己負担', svc.self_payment, isSubsidySelfPayment(svc) ? 'modal-dd-subsidy' : null);
    addBenefitRow(svc.benefit);
    addRow('内容', svc.description);
    addRow('補足条件', svc.notes);

    if (svc.official_url) {
      els.modalOfficial.href = svc.official_url;
      els.modalOfficial.hidden = false;
    } else {
      els.modalOfficial.hidden = true;
      els.modalOfficial.removeAttribute('href');
    }

    els.modalOverlay.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function addRow(label, value, ddClass) {
    if (!value) return;
    els.modalBody.appendChild(el('dt', null, label));
    els.modalBody.appendChild(el('dd', ddClass ? { class: ddClass } : null, value));
  }

  function addBenefitRow(benefit) {
    if (!benefit) return;
    els.modalBody.appendChild(el('dt', null, 'もらえるもの'));
    const dd = el('dd', { class: 'modal-dd-benefit' });
    if (Array.isArray(benefit)) {
      const ul = el('ul');
      benefit.forEach(b => ul.appendChild(el('li', null, b)));
      dd.appendChild(ul);
    } else {
      dd.textContent = benefit;
    }
    els.modalBody.appendChild(dd);
  }

  function closeModal() {
    els.modalOverlay.hidden = true;
    document.body.style.overflow = '';
  }

  // ====== 初期化 ======
  function bindElements() {
    els.backButton = $('backButton');
    els.categoryTabs = $('categoryTabs');
    els.categoryCardList = $('categoryCardList');
    els.dateForm = $('dateForm');
    els.dateInput = $('dateInput');
    els.dateSummary = $('dateSummary');
    els.dateResult = $('dateResult');
    els.cardListNow = $('cardListNow');
    els.cardListSoon = $('cardListSoon');
    els.cardListLong = $('cardListLong');
    els.modalOverlay = $('modalOverlay');
    els.modalClose = $('modalClose');
    els.modalTitle = $('modalTitle');
    els.modalTags = $('modalTags');
    els.modalBody = $('modalBody');
    els.modalOfficial = $('modalOfficial');
  }

  function bindEvents() {
    window.addEventListener('hashchange', () => navigate(parseHash()));

    els.backButton.addEventListener('click', () => {
      if (history.length > 1 && document.referrer) history.back();
      else location.hash = '#/';
    });

    els.modalClose.addEventListener('click', closeModal);
    els.modalOverlay.addEventListener('click', (e) => {
      if (e.target === els.modalOverlay) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !els.modalOverlay.hidden) closeModal();
    });
  }

  async function init() {
    bindElements();
    bindEvents();
    try {
      await loadServices();
      setupDateForm();
      navigate(parseHash());
    } catch (err) {
      console.error(err);
      const main = document.getElementById('app');
      main.appendChild(el('p', { class: 'result-empty' }, 'データの読込に失敗しました。ページを再読み込みしてください。'));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
