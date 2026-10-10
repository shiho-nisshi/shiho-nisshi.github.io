/*
 * 原本画像ビューア：原本のIIIF画像を本文の横（狭い画面では下）に表示する
 *
 * 法律情報基盤の議事録（law-platform.github.io/arthis/minutes/）の minutes.js と同じ作り。
 *   - [data-frame] を持つ要素（記事カード・人物カード）がそれぞれ原本のコマを指す
 *   - その中の「原本 コマN →」（.source）のクリックで、リンク先へ移る代わりにそのコマを開く
 *     （Ctrl/⌘/Shift クリックなどは通常どおり原本サイトを開く）
 *   - [data-viewer-toggle]（「原本画像を並べて表示 →」）で開閉する
 *   - 「本文に連動」が有効なら、スクロールに合わせて表示中のカードのコマに切り替える
 *   - ページを開いた時点では常に閉じている（以前は開閉を localStorage に覚えて次のページでも開いていた）
 *
 * 原本サイトの違いは window.SOURCE_VIEWER で指定する（無ければ国立国会図書館）:
 *   国立国会図書館: 各カードの data-pid / data-frame から画像URLを組み立てる
 *   国立公文書館:  { images: [コマ1のIIIF画像URL, コマ2…], page: '…/img/3688059#{frame}', site: '公文書館' }
 *                  （画像URLがコマ番号から組み立てられないので、manifest から一覧を埋め込む）
 *
 * 正本は 近世近代人名アーカイブス用データ作成/program/publish/source_viewer.js。
 * 各サイトの source_viewer.js は generate_docs.py が生成時にコピーしたもの（直接編集しない）。
 */
(() => {
  const OSD_URL = 'https://cdnjs.cloudflare.com/ajax/libs/openseadragon/5.0.1/openseadragon.min.js';
  const cfg = window.SOURCE_VIEWER || {};
  const parts = [...document.querySelectorAll('[data-frame]')];
  if (!parts.length) return;

  const iiifInfo = cfg.images
    ? (pid, frame) => `${cfg.images[frame - 1]}/info.json`
    : (pid, frame) => `https://dl.ndl.go.jp/api/iiif/${pid}/R${String(frame).padStart(7, '0')}/info.json`;
  const sourcePage = cfg.page
    ? (pid, frame) => cfg.page.replace('{frame}', frame)
    : (pid, frame) => `https://dl.ndl.go.jp/pid/${pid}/1/${frame}`;
  const maxFrame = cfg.images ? cfg.images.length : Infinity;

  const style = document.createElement('style');
  style.textContent = `
#viewer { position: fixed; z-index: 50; display: flex; flex-direction: column; background: #1f2937; color: #e5e7eb; font-size: 0.875rem; }
#viewer[hidden] { display: none; }
.viewer-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 6px 10px; background: #111827; }
.viewer-bar button { font: inherit; min-width: 32px; height: 28px; padding: 0 8px; color: #e5e7eb; background: #374151; border: none; border-radius: 6px; cursor: pointer; }
.viewer-bar button:hover { background: #4b5563; }
.viewer-bar .label { font-variant-numeric: tabular-nums; min-width: 5.5em; text-align: center; }
.viewer-bar label { display: flex; align-items: center; gap: 4px; cursor: pointer; white-space: nowrap; }
.viewer-bar input { accent-color: #2563eb; }
.viewer-bar a { color: #93c5fd; text-decoration: none; white-space: nowrap; }
.viewer-bar a:hover { text-decoration: underline; }
.viewer-bar .spacer { flex: 1; }
#viewer-canvas { position: relative; flex: 1; min-height: 0; }
.viewer-msg { position: absolute; inset: 0; display: grid; place-items: center; color: #9ca3af; pointer-events: none; }
@media (min-width: 1024px) {
  #viewer { top: 0; right: 0; bottom: 0; width: 46vw; border-left: 1px solid #111827; }
  body.viewer-open { padding-right: 46vw; }
}
@media (max-width: 1023px) {
  #viewer { left: 0; right: 0; bottom: 0; height: 48vh; }
  body.viewer-open { padding-bottom: 48vh; }
}
.viewer-toggle { font: inherit; color: #2563eb; background: none; border: none; padding: 0; cursor: pointer; }
.viewer-toggle:hover { text-decoration: underline; }
[data-frame] .source { color: #2563eb; text-decoration: none; font-size: 0.75rem; white-space: nowrap; }
[data-frame] .source:hover { text-decoration: underline; }
/* 原本画像に表示中の箇所 */
[data-frame].is-shown { border-color: #2563eb; box-shadow: 0 0 0 1px #2563eb; }
`;
  document.head.appendChild(style);

  // ── 画面部品 ──
  const panel = document.createElement('aside');
  panel.id = 'viewer';
  panel.hidden = true;
  panel.setAttribute('aria-label', '原本画像');
  panel.innerHTML = `
    <div class="viewer-bar">
      <button type="button" data-act="prev" title="前のコマ">‹</button>
      <span class="label"></span>
      <button type="button" data-act="next" title="次のコマ">›</button>
      <label title="スクロールに合わせて表示中の箇所のコマに切り替える"><input type="checkbox" checked> 本文に連動</label>
      <span class="spacer"></span>
      <button type="button" data-act="right" title="右頁を拡大">右頁</button>
      <button type="button" data-act="left" title="左頁を拡大">左頁</button>
      <button type="button" data-act="home" title="全体を表示">全体</button>
      <button type="button" data-act="in" title="拡大">＋</button>
      <button type="button" data-act="out" title="縮小">－</button>
      <a class="site" target="_blank" rel="noopener"></a>
      <button type="button" data-act="close" title="閉じる">×</button>
    </div>
    <div id="viewer-canvas"><div class="viewer-msg"></div></div>`;
  document.body.appendChild(panel);
  const label = panel.querySelector('.label');
  const followBox = panel.querySelector('input');
  const siteLink = panel.querySelector('.site');
  const msg = panel.querySelector('.viewer-msg');
  siteLink.textContent = `${cfg.site || 'NDL'} →`;

  let osd = null;
  let osdLoading = null;
  let shown = null;        // { pid, frame }
  let shownCard = null;

  function loadOsd() {
    if (window.OpenSeadragon) return Promise.resolve();
    osdLoading ??= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = OSD_URL;
      s.onload = resolve;
      s.onerror = () => reject(new Error('OpenSeadragon を読み込めませんでした'));
      document.head.appendChild(s);
    });
    return osdLoading;
  }

  async function show(pid, frame) {
    frame = Math.min(Math.max(1, frame), maxFrame);
    if (shown && shown.pid === pid && shown.frame === frame) return;
    shown = { pid, frame };
    label.textContent = `コマ ${frame}`;
    siteLink.href = sourcePage(pid, frame);
    msg.textContent = '読み込み中…';
    try {
      await loadOsd();
    } catch (e) {
      msg.textContent = e.message;
      return;
    }
    if (!osd) {
      osd = OpenSeadragon({
        element: document.getElementById('viewer-canvas'),
        showNavigationControl: false,
        gestureSettingsMouse: { clickToZoom: false },
        visibilityRatio: 0.5,
        minZoomImageRatio: 0.5,
        animationTime: 0.4,
      });
      osd.addHandler('open', () => { msg.textContent = ''; });
      osd.addHandler('open-failed', () => { msg.textContent = '画像を読み込めませんでした'; });
    }
    osd.open(iiifInfo(pid, frame));
  }

  function markCard(card) {
    if (shownCard === card) return;
    shownCard?.classList.remove('is-shown');
    shownCard = card;
    card?.classList.add('is-shown');
  }

  function showCard(card) {
    if (!card) return;
    markCard(card);
    show(card.dataset.pid, Number(card.dataset.frame));
  }

  // 画面上部 1/4 の位置にかかっているカード（表示切替・種別フィルタで隠れているものは除く）
  function currentCard() {
    const line = window.innerHeight * 0.25;
    let cur = null;
    for (const p of parts) {
      if (!p.offsetParent) continue;
      if (cur && p.getBoundingClientRect().top > line) break;
      cur = p;
    }
    return cur;
  }

  function open(card) {
    panel.hidden = false;
    document.body.classList.add('viewer-open');
    showCard(card || currentCard());
  }

  function close() {
    panel.hidden = true;
    document.body.classList.remove('viewer-open');
    markCard(null);
  }

  // ── 操作 ──
  panel.addEventListener('click', e => {
    const act = e.target.closest('button')?.dataset.act;
    if (!act) return;
    const vp = osd?.viewport;
    switch (act) {
      case 'prev':
      case 'next':
        if (!shown) break;
        followBox.checked = false;
        markCard(null);
        show(shown.pid, shown.frame + (act === 'next' ? 1 : -1));
        break;
      case 'close': close(); break;
      case 'home': vp?.goHome(); break;
      case 'in': vp?.zoomBy(1.5); break;
      case 'out': vp?.zoomBy(1 / 1.5); break;
      case 'right':
      case 'left': {
        const item = osd?.world.getItemAt(0);
        if (!item) break;
        const b = item.getBounds();
        vp.fitBounds(new OpenSeadragon.Rect(b.x + (act === 'right' ? b.width / 2 : 0), b.y, b.width / 2, b.height));
        break;
      }
    }
  });

  followBox.addEventListener('change', () => { if (followBox.checked) showCard(currentCard()); });

  document.addEventListener('click', e => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const toggle = e.target.closest('[data-viewer-toggle]');
    if (toggle) { panel.hidden ? open() : close(); return; }
    const src = e.target.closest('[data-frame] .source');
    if (!src) return;
    e.preventDefault();
    const card = src.closest('[data-frame]');
    followBox.checked = true;
    open(card);
    card.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (panel.hidden || !followBox.checked || ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; showCard(currentCard()); });
  }, { passive: true });

})();
