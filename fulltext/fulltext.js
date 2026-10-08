/*
 * 全文検索（静的索引をブラウザ側で検索する）
 *
 * 索引は fulltext_index.py がビルド時に生成する（形式はそちらの冒頭コメント参照）。
 * このファイルは各サイトの fulltext/fulltext.js にコピーされて公開される。
 * 正本は 近世近代人名アーカイブス用データ作成/program/publish/fulltext.js なので、
 * 直すときは正本を直してから各サイトの generate_docs.py を実行し直すこと。
 *
 * 使い方（検索欄）:
 *   const fts = FullTextSearch.mount(要素, { base: 'fulltext/', hashKey: 'fulltext', groupLabel: '巻' });
 *     live: true で入力しながら検索、onChange(検索中か) で検索の開始・解除を受け取れる
 *     （司法省日誌の索引ページは、これで検索中だけ巻一覧を隠している）
 *   fts.restoreFromHash();   // URLが #fulltext?q=… なら検索を復元して true を返す
 *   fts.hash();              // 現在の検索状態を表す '#fulltext?q=…'（タブ切替時のURL用）
 * 使い方（資料ページ）: 検索結果のリンクには ?q=… が付くので、開いた先で検索語を強調する
 *   FullTextSearch.highlightFromQuery({ base: '../fulltext/', root: '.doc-body' });
 */
(function () {
  'use strict';

  // fulltext_index.py の WHITESPACE / FIELD_SEP と同じ
  const WS = new Set([' ', '\t', '\n', '\r', '\f', '\v']);
  const FIELD_SEP = '\x1f';
  const CONTEXT = 40;
  const MAX_SNIPPETS = 3;

  const CSS = `
.fts-form { display: flex; border: 1px solid #d1d5db; border-radius: 8px; background: #fff; overflow: hidden;
  box-shadow: 0 1px 2px rgba(0,0,0,.05); transition: box-shadow .15s, border-color .15s; }
.fts-form:focus-within { border-color: #3b82f6; box-shadow: 0 0 0 2px #3b82f6; }
.fts-input { flex: 1; min-width: 0; padding: 12px 16px; border: 0; outline: none; font: inherit; font-size: 1rem;
  background: transparent; color: #111827; }
.fts-btn { padding: 12px 24px; border: 0; background: #2563eb; color: #fff; font: inherit; font-size: 1rem;
  font-weight: 500; cursor: pointer; transition: background .15s; }
.fts-btn:hover { background: #1d4ed8; }
.fts-btn:disabled { opacity: .5; cursor: not-allowed; }
.fts-help { margin: 8px 0 24px; font-size: .8125rem; color: #6b7280; line-height: 1.7; }
.fts-status { text-align: center; padding: 24px; color: #4b5563; }
.fts-status.fts-error { color: #dc2626; }
.fts-spinner { display: inline-block; width: 18px; height: 18px; margin-right: 6px; vertical-align: middle;
  border: 2px solid #e5e7eb; border-top-color: #2563eb; border-radius: 50%; animation: fts-spin .7s linear infinite; }
@keyframes fts-spin { to { transform: rotate(360deg); } }
.fts-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px;
  margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid #e5e7eb; font-size: .9rem; color: #4b5563; }
.fts-head strong { color: #111827; }
.fts-group { max-width: 100%; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff;
  font: inherit; font-size: .875rem; color: #111827; }
.fts-list { list-style: none; margin: 0; padding: 0; }
.fts-item { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; margin-bottom: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.04); }
.fts-item-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
.fts-title { font-weight: 600; color: #2563eb; text-decoration: none; word-break: break-all; }
.fts-title:hover { text-decoration: underline; }
.fts-badge { display: inline-block; padding: 0 8px; border: 1px solid #d1d5db; border-radius: 9999px;
  font-size: .75rem; line-height: 1.5rem; color: #4b5563; white-space: nowrap; }
.fts-hits { font-size: .75rem; color: #6b7280; margin-left: auto; white-space: nowrap; }
.fts-snip { margin-top: 6px; font-size: .9rem; line-height: 1.8; color: #374151; word-break: break-all; }
.fts-snip + .fts-snip { margin-top: 2px; }
.fts-snip mark { background: #fef08a; color: #1f2937; padding: 0 2px; border-radius: 2px; }
mark.fts-hl { background: #fef08a; color: inherit; padding: 0 1px; border-radius: 2px; }
.fts-sep { color: #9ca3af; margin: 0 .25em; }
.fts-more { margin-top: 2px; font-size: .75rem; color: #6b7280; }
.fts-pager { display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 20px; }
.fts-pager button { padding: 6px 14px; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; font: inherit;
  font-size: .875rem; color: #374151; cursor: pointer; }
.fts-pager button:hover:not(:disabled) { border-color: #2563eb; color: #2563eb; background: #eff6ff; }
.fts-pager button:disabled { opacity: .35; cursor: not-allowed; }
.fts-pager span { font-size: .875rem; color: #4b5563; }
.fts-empty { text-align: center; padding: 40px 16px; color: #4b5563; }
`;

  function injectStyle() {
    if (document.getElementById('fts-style')) return;
    const el = document.createElement('style');
    el.id = 'fts-style';
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  // fulltext_index.py の shard_of と同じハッシュ
  function shardOf(key, n) {
    let h = 0;
    for (const ch of key) h = (Math.imul(h, 31) + ch.codePointAt(0)) >>> 0;
    return h % n;
  }

  function hasSorted(arr, x) {
    let lo = 0, hi = arr.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] === x) return true;
      if (arr[mid] < x) lo = mid + 1; else hi = mid - 1;
    }
    return false;
  }

  // 昇順の starts の中で x 以下の最後の位置
  function lastAtOrBelow(starts, x) {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= x) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  class Index {
    constructor(base) {
      this.base = base;
      this.files = new Map();
      this.decoded = new Map();
      this.meta = null;
    }

    json(path) {
      if (!this.files.has(path)) {
        const p = fetch(this.base + path).then(r => {
          if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
          return r.json();
        });
        p.catch(() => this.files.delete(path));
        this.files.set(path, p);
      }
      return this.files.get(path);
    }

    async load() {
      if (this.meta) return;
      const meta = await this.json('meta.json');
      const table = meta.norm;
      const memo = new Map();
      // fulltext_index.py の normalize_char と同じ規則（旧字→新字、NFKC、再度旧字→新字、ひらがな→カタカナ、
      // 英大文字→小文字、空白・改行は除去）
      this.normChar = c => {
        let r = memo.get(c);
        if (r !== undefined) return r;
        const tr = x => (Object.prototype.hasOwnProperty.call(table, x) ? table[x] : x);
        // 旧字→新字 → NFKC → （NFKCの結果がさらに旧字なら）もう一度 旧字→新字
        const t = Array.from(tr(c).normalize('NFKC'), tr).join('');
        r = '';
        for (const ch of t) {
          if (WS.has(ch)) continue;
          const cp = ch.codePointAt(0);
          if ((cp >= 0x3041 && cp <= 0x3096) || cp === 0x309D || cp === 0x309E) r += String.fromCodePoint(cp + 0x60);
          else if (cp >= 0x41 && cp <= 0x5A) r += String.fromCharCode(cp + 0x20);
          else r += ch;
        }
        memo.set(c, r);
        return r;
      };
      this.groupStarts = meta.groups.map(g => g[1]);
      this.meta = meta;
    }

    normalize(text) {
      let s = '';
      for (const c of text) s += this.normChar(c);
      return s;
    }

    // 正規化後の文字列 s と、s の各UTF-16位置 → 原文での [開始, 終了) 位置
    normalizeWithMap(text) {
      let s = '';
      const st = [], en = [];
      let i = 0;
      for (const c of text) {
        const n = this.normChar(c);
        for (let k = 0; k < n.length; k++) { st.push(i); en.push(i + c.length); }
        s += n;
        i += c.length;
      }
      return { s, st, en };
    }

    // bigram → Map(文書番号 → 出現位置の昇順配列)
    async bigram(key) {
      const ck = 'b' + key;
      if (this.decoded.has(ck)) return this.decoded.get(ck);
      const shard = await this.json(`b/${shardOf(key, this.meta.bShards)}.json`);
      const m = Index.decode(shard[key] || []);
      this.decoded.set(ck, m);
      return m;
    }

    // [文書番号差分, 出現数, 位置差分...] → Map(文書番号 → 出現位置の昇順配列)
    static decode(flat) {
      const m = new Map();
      let d = 0, i = 0;
      while (i < flat.length) {
        d += flat[i++];
        const n = flat[i++];
        const ps = new Array(n);
        let p = 0;
        for (let k = 0; k < n; k++) { p += flat[i++]; ps[k] = p; }
        m.set(d, ps);
      }
      return m;
    }

    // 1文字 → Map(文書番号 → 出現位置の配列。位置を持たない索引（全文検索）では null)
    async unigram(c) {
      const shard = await this.json(`u/${shardOf(c, this.meta.uShards)}.json`);
      const flat = shard[c] || [];
      if (this.meta.uPos) return Index.decode(flat);
      const m = new Map();
      let d = 0;
      for (const delta of flat) { d += delta; m.set(d, null); }
      return m;
    }

    // 正規化済みの1語（コードポイント配列）を含む文書 → Map(文書番号 → 語の先頭の出現位置の配列。
    // 1文字の語で、索引が位置を持たない場合は null)
    async matchTerm(cps) {
      if (cps.length === 1) return this.unigram(cps[0]);
      const L = cps.length;
      const offsets = [];
      for (let o = 0; o <= L - 2; o += 2) offsets.push(o);
      if (offsets[offsets.length - 1] !== L - 2) offsets.push(L - 2);
      const lists = await Promise.all(offsets.map(o => this.bigram(cps[o] + cps[o + 1])));
      const result = new Map();
      if (lists.some(m => m.size === 0)) return result;
      const smallest = lists.reduce((a, b) => (a.size <= b.size ? a : b));
      for (const d of smallest.keys()) {
        if (!lists.every(m => m.has(d))) continue;
        const starts = lists[0].get(d).filter(p => {
          for (let k = 1; k < lists.length; k++) {
            if (!hasSorted(lists[k].get(d), p + offsets[k])) return false;
          }
          return true;
        });
        if (starts.length) result.set(d, starts);
      }
      return result;
    }

    // すべての語を含む文書番号（昇順）
    async search(normTerms) {
      const maps = await Promise.all(normTerms.map(t => this.matchTerm(Array.from(t))));
      maps.sort((a, b) => a.size - b.size);
      const docs = [];
      for (const d of maps[0].keys()) {
        if (maps.every(m => m.has(d))) docs.push(d);
      }
      return docs.sort((a, b) => a - b);
    }

    groupOf(docNo) {
      return lastAtOrBelow(this.groupStarts, docNo);
    }

    // 文書番号 → [url, 見出し, バッジ, 本文]
    async docs(docNos) {
      const chunks = this.meta.chunks;
      const needed = new Set(docNos.map(d => lastAtOrBelow(chunks, d)));
      const loaded = new Map();
      await Promise.all([...needed].map(async k => loaded.set(k, await this.json(`t/${k}.json`))));
      const out = new Map();
      for (const d of docNos) {
        const k = lastAtOrBelow(chunks, d);
        out.set(d, loaded.get(k)[d - chunks[k]]);
      }
      return out;
    }
  }

  function renderSnippetText(text) {
    return escapeHtml(text).replace(/\n/g, '').replace(/\x1f/g, '<span class="fts-sep">／</span>');
  }

  // 検索語: 空白区切り、正規化済み、重複なし
  function queryTerms(index, q) {
    return [...new Set(q.trim().split(/\s+/).map(t => index.normalize(t)).filter(Boolean))];
  }

  // 原文 text の中の検索語の出現箇所 → 原文での [[開始, 終了), ...]（重なり・隣接はまとめる）
  function findHits(index, text, normTerms) {
    const { s, st, en } = index.normalizeWithMap(text);
    const hits = [];
    for (const t of normTerms) {
      for (let i = s.indexOf(t); i !== -1; i = s.indexOf(t, i + 1)) hits.push([st[i], en[i + t.length - 1]]);
    }
    hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [];
    for (const h of hits) {
      const last = merged[merged.length - 1];
      if (last && h[0] <= last[1]) last[1] = Math.max(last[1], h[1]);
      else merged.push([h[0], h[1]]);
    }
    return merged;
  }

  // 本文中の検索語の出現箇所を前後の文脈つきで（最大MAX_SNIPPETS箇所）
  function snippetsHtml(index, text, normTerms) {
    const hits = findHits(index, text, normTerms);
    if (!hits.length) return { html: '', count: 0 };

    const isLow = i => { const c = text.charCodeAt(i); return c >= 0xDC00 && c <= 0xDFFF; };
    const windows = [];
    for (const [a, b] of hits) {
      let ws = Math.max(0, a - CONTEXT), we = Math.min(text.length, b + CONTEXT);
      if (ws > 0 && isLow(ws)) ws--;
      if (we < text.length && isLow(we)) we++;
      const last = windows[windows.length - 1];
      if (last && ws <= last.end) { last.end = Math.max(last.end, we); last.hits.push([a, b]); }
      else windows.push({ start: ws, end: we, hits: [[a, b]] });
    }

    let html = '';
    for (const w of windows.slice(0, MAX_SNIPPETS)) {
      let pos = w.start;
      let body = w.start > 0 ? '…' : '';
      for (const [a, b] of w.hits) {
        body += renderSnippetText(text.slice(pos, a)) + '<mark>' + renderSnippetText(text.slice(a, b)) + '</mark>';
        pos = b;
      }
      body += renderSnippetText(text.slice(pos, w.end)) + (w.end < text.length ? '…' : '');
      html += `<div class="fts-snip">${body}</div>`;
    }
    const rest = windows.slice(MAX_SNIPPETS).reduce((n, w) => n + w.hits.length, 0);
    if (rest) html += `<div class="fts-more">ほか${rest}箇所</div>`;
    return { html, count: hits.length };
  }

  function mount(root, opts) {
    injectStyle();
    const base = opts.base || 'fulltext/';
    const hashKey = opts.hashKey || 'fulltext';
    const groupLabel = opts.groupLabel || '資料';
    const pageSize = opts.pageSize || 50;
    const index = new Index(base);

    root.innerHTML = `
      <form class="fts-form" role="search">
        <input type="search" class="fts-input" aria-label="全文検索" autocomplete="off">
        <button type="submit" class="fts-btn">検索</button>
      </form>
      <p class="fts-help">旧字・新字、ひらがな・カタカナの違いや改行は区別せずに探します。スペースで区切ると、すべての語を含むものを探します。</p>
      <div class="fts-results" aria-live="polite"></div>`;
    const form = root.querySelector('.fts-form');
    const input = root.querySelector('.fts-input');
    const button = root.querySelector('.fts-btn');
    const area = root.querySelector('.fts-results');

    // 現在の検索状態
    let state = { q: '', terms: [], docs: [], group: -1, page: 1 };
    let token = 0;

    function hash() {
      if (!state.q) return '#' + hashKey;
      const p = new URLSearchParams({ q: state.q });
      if (state.group >= 0) p.set('g', state.group);
      if (state.page > 1) p.set('p', state.page);
      return `#${hashKey}?${p}`;
    }

    function filtered() {
      return state.group < 0 ? state.docs : state.docs.filter(d => index.groupOf(d) === state.group);
    }

    async function render() {
      const my = token;
      const groupCounts = new Map();
      for (const d of state.docs) {
        const g = index.groupOf(d);
        groupCounts.set(g, (groupCounts.get(g) || 0) + 1);
      }
      if (!groupCounts.has(state.group)) state.group = -1;
      const docs = filtered();
      const totalPages = Math.max(1, Math.ceil(docs.length / pageSize));
      state.page = Math.min(Math.max(1, state.page), totalPages);
      history.replaceState(null, '', location.pathname + location.search + hash());
      if (!state.docs.length) {
        area.innerHTML = `<div class="fts-empty">「${escapeHtml(state.q)}」を含む本文はありませんでした</div>`;
        return;
      }
      const pageDocs = docs.slice((state.page - 1) * pageSize, state.page * pageSize);
      const data = await index.docs(pageDocs);
      if (my !== token) return;

      let options = `<option value="-1">すべての${escapeHtml(groupLabel)}（${state.docs.length}件）</option>`;
      for (const [g, n] of [...groupCounts].sort((a, b) => a[0] - b[0])) {
        const sel = g === state.group ? ' selected' : '';
        options += `<option value="${g}"${sel}>${escapeHtml(index.meta.groups[g][0])}（${n}件）</option>`;
      }

      let html = `
        <div class="fts-head">
          <span>「<strong>${escapeHtml(state.q)}</strong>」— 全${state.docs.length}件${state.group >= 0 ? `（うち${docs.length}件を表示）` : ''}</span>
          <select class="fts-group" aria-label="${escapeHtml(groupLabel)}で絞り込み">${options}</select>
        </div>
        <ol class="fts-list">`;
      for (const d of pageDocs) {
        const [url, title, badges, text] = data.get(d);
        // 資料ページ側で検索語を強調できるよう ?q= を付ける（docs/12.html?q=…#a12-200）
        const [path, frag] = url.split('#');
        const href = `${path}?q=${encodeURIComponent(state.q)}${frag ? '#' + frag : ''}`;
        const snip = snippetsHtml(index, text, state.terms);
        html += `
          <li class="fts-item">
            <div class="fts-item-head">
              <a class="fts-title" href="${escapeHtml(href)}">${escapeHtml(title || '（見出しなし）')}</a>
              ${[index.meta.groups[index.groupOf(d)][0], ...badges].filter(Boolean).map(b => `<span class="fts-badge">${escapeHtml(b)}</span>`).join('')}
              ${snip.count > 1 ? `<span class="fts-hits">${snip.count}箇所</span>` : ''}
            </div>
            ${snip.html}
          </li>`;
      }
      html += '</ol>';
      if (totalPages > 1) {
        html += `
          <div class="fts-pager">
            <button type="button" data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''}>← 前へ</button>
            <span>${state.page} / ${totalPages} ページ</span>
            <button type="button" data-page="${state.page + 1}" ${state.page === totalPages ? 'disabled' : ''}>次へ →</button>
          </div>`;
      }
      area.innerHTML = html;
      area.querySelector('.fts-group').addEventListener('change', e => {
        state.group = Number(e.target.value);
        state.page = 1;
        show();
      });
      area.querySelectorAll('.fts-pager button').forEach(btn => btn.addEventListener('click', () => {
        state.page = Number(btn.dataset.page);
        show().then(() => root.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      }));
    }

    async function show() {
      token++;
      try {
        await render();
      } catch (err) {
        area.innerHTML = `<div class="fts-status fts-error">エラーが発生しました: ${escapeHtml(err.message)}</div>`;
      }
    }

    // 検索語が空になったら結果を消して元の表示に戻す（opts.onChange(false) で一覧を出し直してもらう）
    function clear() {
      token++;
      state = { q: '', terms: [], docs: [], group: -1, page: 1 };
      area.innerHTML = '';
      button.disabled = false;
      history.replaceState(null, '', location.pathname + location.search);
      opts.onChange?.(false);
    }

    async function search(q, group = -1, page = 1) {
      q = q.trim();
      if (input.value.trim() !== q) input.value = q;
      if (!q) {
        if (opts.live) clear(); else input.focus();
        return;
      }
      opts.onChange?.(true);
      const my = ++token;
      button.disabled = true;
      area.innerHTML = '<div class="fts-status"><span class="fts-spinner"></span>検索中…</div>';
      try {
        await index.load();
        const terms = queryTerms(index, q);
        const docs = terms.length ? await index.search(terms) : [];
        if (my !== token) return;
        state = { q, terms, docs, group, page };
        await render();
      } catch (err) {
        if (my === token) area.innerHTML = `<div class="fts-status fts-error">エラーが発生しました: ${escapeHtml(err.message)}</div>`;
      } finally {
        if (my === token) button.disabled = false;
      }
    }

    let timer = null;
    form.addEventListener('submit', e => { e.preventDefault(); clearTimeout(timer); search(input.value); });
    if (opts.live) {
      // 入力しながら検索する（law-platform 議事録の一覧と同じく、打ち終わって 0.4 秒後）。
      // 「×」で消したとき（search イベント）はすぐ反映する
      input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => { if (input.value.trim() !== state.q) search(input.value); }, 400);
      });
      input.addEventListener('search', () => { if (!input.value.trim()) { clearTimeout(timer); clear(); } });
    }

    function restoreFromHash() {
      const h = location.hash;
      if (h !== '#' + hashKey && !h.startsWith(`#${hashKey}?`)) return false;
      const p = new URLSearchParams(h.slice(hashKey.length + 2));
      const q = p.get('q');
      if (q && q !== state.q) search(q, p.has('g') ? Number(p.get('g')) : -1, Number(p.get('p')) || 1);
      return true;
    }

    return { search, hash, restoreFromHash, focus: () => input.focus() };
  }

  // 全文検索の結果から開かれた資料ページ（?q=…）で、本文中の検索語を強調し、
  // 該当の記事・人物（#id）の中か、最初の該当箇所へ移る（law-platform 議事録の minutes.js と同じ）。
  // 照合は検索と同じ正規化（旧字・新字、ひらがな・カタカナ、改行の違いは無視）。要素をまたぐ語は強調しない
  //   base: 索引のディレクトリ（'../fulltext/'）、root: 強調する範囲のセレクタ
  async function highlightFromQuery({ base, root }) {
    const q = new URLSearchParams(location.search).get('q');
    const roots = [...document.querySelectorAll(root)];
    if (!q || !roots.length) return;
    injectStyle();
    const index = new Index(base);
    await index.load();
    const terms = queryTerms(index, q);
    if (!terms.length) return;
    for (const r of roots) {
      const walker = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const text = node.nodeValue;
        const hits = findHits(index, text, terms);
        if (!hits.length) continue;
        const frag = document.createDocumentFragment();
        let pos = 0;
        for (const [a, b] of hits) {
          frag.append(text.slice(pos, a));
          const m = document.createElement('mark');
          m.className = 'fts-hl';
          m.textContent = text.slice(a, b);
          frag.append(m);
          pos = b;
        }
        frag.append(text.slice(pos));
        node.replaceWith(frag);
      }
    }
    // 表示切替・種別フィルタで隠れている箇所は飛ばす
    const visibleMark = el => [...el.querySelectorAll('mark.fts-hl')].find(m => m.offsetParent);
    const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    const first = (target && visibleMark(target)) || roots.map(visibleMark).find(Boolean);
    if (first) first.scrollIntoView({ block: 'center' });
  }

  // 原文 text を HTML にし、検索語（正規化済み）の箇所を <mark> で囲む（人物検索の結果表示用）。
  // 改行をまたぐ箇所は改行の前後で <mark> を分ける（呼び出し側が改行で行に分けるため）
  function markHtml(index, text, normTerms) {
    text = String(text ?? '');
    const hits = normTerms.length ? findHits(index, text, normTerms) : [];
    let html = '', pos = 0;
    for (const [a, b] of hits) {
      html += escapeHtml(text.slice(pos, a)) + '<mark>' + escapeHtml(text.slice(a, b)).replace(/\n/g, '</mark>\n<mark>') + '</mark>';
      pos = b;
    }
    return html + escapeHtml(text.slice(pos));
  }

  window.FullTextSearch = {
    mount,
    highlightFromQuery,
    // 人物検索（index.html の「検索」タブ）が同じ索引形式・正規化を使うための部品
    openIndex: base => new Index(base),
    queryTerms,
    markHtml,
  };
})();
