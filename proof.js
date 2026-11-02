// 校正用の Google フォームへのリンク「修正する」を、巻ページの各記事カードに付ける。
// build.py の PROOF_FORM_URL が空でないときだけ、生成時に github/proof.js へコピーされ、巻ページで
// window.PROOF_FORM_URL（フォームの事前入力 URL。ID・HEAD・TEXT の3つの値を含む）と一緒に読み込まれる。
// フォームは ../../司法省日誌データ作成/program/proof_form/create_form.gs で作る
(function () {
  var formUrl = window.PROOF_FORM_URL;
  if (!formUrl) return;

  // URL が長すぎると Google フォームが開けない（日本語は1字が9文字になる）。超えるときは本文を入れずに開き、
  // 本文はクリップボードにコピーして貼ってもらう
  var MAX_URL_LENGTH = 8000;

  function fill(url, key, value) {
    return url.replace(new RegExp('=' + key + '(?=&|$)'), '=' + encodeURIComponent(value));
  }

  // 表示中の本文を文字列にする。人事記事の表（.jinji）は1行1行、空でない列を全角スペースでつなぐ（build.py の p_text と同じ形）
  function bodyText(body) {
    var out = '';
    body.childNodes.forEach(function (n) {
      if (n.nodeName === 'TABLE') {
        if (out && out.slice(-1) !== '\n') out += '\n';
        Array.prototype.forEach.call(n.rows, function (tr) {
          out += Array.prototype.map.call(tr.cells, function (td) { return td.textContent; })
            .filter(function (s) { return s; }).join('　') + '\n';
        });
      } else {
        out += n.textContent;
      }
    });
    return out.replace(/\n+$/, '');
  }

  function openForm(card) {
    var head = card.querySelector('.item-body').previousElementSibling.textContent;
    var text = bodyText(card.querySelector('.item-body'));
    var url = fill(fill(formUrl, 'ID', card.id), 'HEAD', head);
    var full = fill(url, 'TEXT', text);
    if (full.length <= MAX_URL_LENGTH) {
      window.open(full, '_blank', 'noopener');
      return;
    }
    // コピーはクリックの直後でないと許されないので、フォームを開く前に始める
    var copied = navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject();
    window.open(fill(url, 'TEXT', ''), '_blank', 'noopener');
    copied.then(function () {
      alert('本文が長いため、フォームに入れられませんでした。\n本文をクリップボードにコピーしたので、「本文（修正後）」に貼り付けてから直してください。');
    }, function () {
      alert('本文が長いため、フォームに入れられませんでした。\nこの記事の本文をコピーして「本文（修正後）」に貼り付けてください。');
    });
  }

  document.querySelectorAll('#articles section[id]').forEach(function (card) {
    var bar = card.querySelector('.ml-auto');
    if (!bar || !card.querySelector('.item-body')) return;
    var a = document.createElement('a');
    a.href = '#';
    a.className = 'text-xs text-blue-600 hover:underline';
    a.textContent = '修正する';
    a.title = '校正用の Google フォームを開く';
    a.addEventListener('click', function (e) { e.preventDefault(); openForm(card); });
    bar.insertBefore(a, bar.firstChild);
  });
})();
