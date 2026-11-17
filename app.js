/* ==========================================================================
   우리 사진 보드 — app.js
   · 참여자: 링크로 들어와 이름(+한 줄 메모)을 적고 사진을 여러 장 올린다.
   · 관리자: 비밀번호로 들어가 사진을 골라 A4 1·2·4·6장 모아찍기로 인쇄/삭제한다.
   · 사진은 올릴 때 브라우저에서 줄여(최대 1400px, JPEG) Supabase 테이블에 담는다.
   · 관리자 비밀번호는 코드에 없다. 서버 RPC 가 기존 가족 비밀번호 해시와 비교한다.
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ 설정 */
  var CONFIG = {
    SUPABASE_URL: 'https://tuejokazctxejnpjmwwt.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_bjAGvM3zPJvP1xX1dU2QnA_k5HhXIVy',
    TABLE: 'photo_board_posts',
    FAMILY_ID: 'family',          // private.family_secrets 의 family_id — 서버가 확인
    PAGE_SIZE: 12,
    MAX_SIDE: 1400,
    JPEG_QUALITY: 0.82,
    MAX_FILE_MB: 25,
    POLL_MS: 25000
  };

  var KEYS = {
    author: 'pb.v1.author',
    per: 'pb.v1.per',
    showName: 'pb.v1.showname',
    cover: 'pb.v1.cover',
    demoPosts: 'pb.v1.demo.posts',
    pass: 'pb.v1.pass'            // 이 탭(sessionStorage)에서만 유지
  };

  var AVATAR_COLORS = [
    ['#3F6B5B', '#2F5347'], ['#8C5A3C', '#6E4229'], ['#4E668C', '#394C6B'],
    ['#8A5B77', '#6A425A'], ['#7B7A3F', '#5C5B2B'], ['#4F7C7A', '#386160'],
    ['#A0584A', '#7C3F34'], ['#6A5D8C', '#4E4469']
  ];

  /* ------------------------------------------------------------- 작은 도구들 */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function ymdToday() {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date());
    } catch (e) {
      var d = new Date();
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }
  }

  function hashOf(text) {
    var h = 0, s = String(text || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100003;
    return h;
  }

  function avatarFor(name) {
    var p = AVATAR_COLORS[hashOf(name) % AVATAR_COLORS.length];
    return { bg: p[0], initial: String(name || '?').trim().charAt(0) || '?' };
  }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    var b = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = [];
    for (var j = 0; j < 16; j++) h.push((b[j] + 0x100).toString(16).slice(1));
    return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' + h.slice(6, 8).join('') +
      '-' + h.slice(8, 10).join('') + '-' + h.slice(10, 16).join('');
  }

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }

  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, value) { try { localStorage.setItem(key, value); return true; } catch (e) { return false; } }
  function ssGet(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } }
  function ssSet(key, value) { try { sessionStorage.setItem(key, value); return true; } catch (e) { return false; } }
  function ssDel(key) { try { sessionStorage.removeItem(key); } catch (e) {} }

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var diff = (now - d) / 1000;
    if (diff < 60) return '방금 전';
    if (diff < 3600) return Math.floor(diff / 60) + '분 전';
    if (diff < 86400 && d.getDate() === now.getDate()) return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    var opts = { month: 'numeric', day: 'numeric' };
    if (d.getFullYear() !== now.getFullYear()) opts.year = '2-digit';
    try {
      return new Intl.DateTimeFormat('ko-KR', opts).format(d);
    } catch (e) {
      return (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
    }
  }

  function fmtFull(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try {
      return new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
      }).format(d);
    } catch (e) { return iso; }
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2800);
  }

  /* ------------------------------------------------------------------ 상태 */
  var state = {
    posts: [],
    mode: 'server',         // 'server' | 'demo'
    loaded: false,
    admin: false,
    pass: '',
    selected: new Set(),
    per: parseInt(lsGet(KEYS.per) || '4', 10) || 4,
    showName: lsGet(KEYS.showName) !== '0',
    cover: lsGet(KEYS.cover) === '1',
    picked: [],             // 올릴 사진들
    lightboxIndex: -1,
    uploading: false,
    polling: null
  };

  /* --------------------------------------------------------------- Supabase */
  function apiHeaders(extra) {
    var h = {
      'apikey': CONFIG.SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) h[k] = extra[k];
    return h;
  }

  function rest(path) { return CONFIG.SUPABASE_URL + '/rest/v1/' + path; }

  function PostError(message, kind) {
    var e = new Error(message);
    e.kind = kind || 'unknown';
    return e;
  }

  function listPosts(limit, offset) {
    var q = CONFIG.TABLE + '?select=id,author,memo,image_data,created_at' +
      '&order=created_at.desc&limit=' + limit + '&offset=' + (offset || 0);
    return fetch(rest(q), { headers: apiHeaders() }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw PostError('목록을 불러오지 못했습니다. (' + res.status + ') ' + t.slice(0, 160),
            (res.status === 404 || res.status === 400 || res.status === 401 || res.status === 403) ? 'setup' : 'network');
        });
      }
      return res.json();
    }, function () {
      throw PostError('서버에 연결하지 못했습니다.', 'offline');
    });
  }

  function insertPost(row) {
    return fetch(rest(CONFIG.TABLE), {
      method: 'POST',
      headers: apiHeaders({ 'Prefer': 'return=minimal' }),
      body: JSON.stringify(row)
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw PostError('사진을 올리지 못했습니다. (' + res.status + ') ' + t.slice(0, 160), 'insert');
        });
      }
      return true;
    }, function () { throw PostError('서버에 연결하지 못했습니다.', 'offline'); });
  }

  function rpc(name, body) {
    return fetch(rest('rpc/' + name), {
      method: 'POST',
      headers: apiHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          var e = PostError('요청을 처리하지 못했습니다. (' + res.status + ')', 'rpc');
          e.detail = t.slice(0, 300);
          throw e;
        });
      }
      return res.text().then(function (t) {
        if (!t) return null;
        try { return JSON.parse(t); } catch (e) { return t; }
      });
    }, function () { throw PostError('서버에 연결하지 못했습니다.', 'offline'); });
  }

  function countPosts() {
    return fetch(rest(CONFIG.TABLE + '?select=id&limit=1'), {
      method: 'HEAD',
      headers: apiHeaders({ 'Prefer': 'count=exact' })
    }).then(function (res) {
      var cr = res.headers.get('content-range') || '';
      var m = cr.match(/\/(\d+)/);
      return m ? parseInt(m[1], 10) : null;
    }).catch(function () { return null; });
  }

  /* ------------------------------------------------------------- 데모 모드 */
  function demoLoad() { return readJSON(KEYS.demoPosts, []); }
  function demoSave(list) { writeJSON(KEYS.demoPosts, list); }

  function enterDemo(reason) {
    state.mode = 'demo';
    var banner = $('serverBanner');
    banner.hidden = false;
    $('bannerTitle').textContent = '체험 모드로 보는 중';
    $('bannerText').textContent =
      '사진 저장 서버에 연결하지 못해 이 브라우저에만 사진이 남습니다. 서버(Supabase)에 사진 표를 만들면 실제 공유됩니다.' +
      (reason ? ' — ' + reason : '');
    $('btnSeed').hidden = false;
  }

  function exitDemo() {
    state.mode = 'server';
    $('serverBanner').hidden = true;
    $('btnSeed').hidden = true;
  }

  /* ------------------------------------------------------------ 사진 줄이기 */
  function loadBitmap(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' })
        .catch(function () { return createImageBitmap(file).catch(function () { return null; }); })
        .then(function (bmp) { return bmp; });
    }
    return Promise.resolve(null);
  }

  function loadViaImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없습니다.')); };
      img.src = url;
    });
  }

  function compressImage(file) {
    return loadBitmap(file).then(function (bmp) {
      if (bmp) return { source: bmp, w: bmp.width, h: bmp.height, release: function () { try { bmp.close(); } catch (e) {} } };
      return loadViaImg(file).then(function (r) {
        return { source: r.img, w: r.img.naturalWidth, h: r.img.naturalHeight, release: function () { URL.revokeObjectURL(r.url); } };
      });
    }).then(function (src) {
      if (!src.w || !src.h) throw new Error('이미지 크기를 알 수 없습니다.');
      var scale = Math.min(1, CONFIG.MAX_SIDE / Math.max(src.w, src.h));
      var w = Math.max(1, Math.round(src.w * scale));
      var h = Math.max(1, Math.round(src.h * scale));

      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src.source, 0, 0, w, h);
      src.release();

      var q = CONFIG.JPEG_QUALITY;
      var data = canvas.toDataURL('image/jpeg', q);
      // 너무 크면 화질을 조금씩 낮춰 700KB(base64) 아래로 맞춘다.
      while (data.length > 700 * 1024 && q > 0.5) {
        q -= 0.08;
        data = canvas.toDataURL('image/jpeg', q);
      }
      return { dataUrl: data, w: w, h: h };
    });
  }

  /* ------------------------------------------------------------------ 렌더 */
  function postById(id) {
    for (var i = 0; i < state.posts.length; i++) if (state.posts[i].id === id) return state.posts[i];
    return null;
  }

  function cardHTML(post, index) {
    var name = (post.author || '').trim() || '익명';
    var av = avatarFor(name);
    var memo = (post.memo || '').trim();
    return '' +
      '<article class="card' + (state.selected.has(post.id) ? ' selected' : '') + '" data-id="' + esc(post.id) + '" data-index="' + index + '">' +
        '<div class="photo">' +
          '<img src="' + esc(post.image_data) + '" alt="' + esc(name) + ' 님이 올린 사진" loading="lazy" data-loading="1" />' +
        '</div>' +
        '<div class="check" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>' +
        '</div>' +
        '<div class="card-tools">' +
          '<button class="tool-btn view" type="button" data-act="view" title="크게 보기" aria-label="크게 보기">' +
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/></svg>' +
          '</button>' +
          '<button class="tool-btn del" type="button" data-act="delete" title="이 사진 삭제" aria-label="이 사진 삭제">' +
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="body">' +
          '<div class="author-row">' +
            '<span class="avatar" style="background:' + av.bg + '">' + esc(av.initial) + '</span>' +
            '<span class="author">' + esc(name) + '</span>' +
            '<span class="date">' + esc(fmtDate(post.created_at)) + '</span>' +
          '</div>' +
          (memo ? '<p class="memo">' + esc(memo) + '</p>' : '') +
        '</div>' +
      '</article>';
  }

  function render() {
    var grid = $('grid');
    grid.innerHTML = state.posts.map(cardHTML).join('');
    applyColumns();
    $('emptyState').hidden = state.posts.length > 0 || !state.loaded;
    $('btnMore').hidden = state.mode === 'demo' ? true : state.posts.length < CONFIG.PAGE_SIZE || state.posts.length % CONFIG.PAGE_SIZE !== 0;
    grid.querySelectorAll('img[data-loading="1"]').forEach(function (img) {
      function done() { img.removeAttribute('data-loading'); scheduleMasonry(); }
      if (img.complete) done(); else { img.addEventListener('load', done); img.addEventListener('error', done); }
    });
    renderSelBar();
  }

  /* 카드 높이를 실제로 재서 행 스팬을 정한다(메이슨리).
     브라우저의 열 높이 균형 계산에 맡기면 사진이 적을 때 빈 열이 크게 남는다. */
  function applyColumns() {
    var grid = $('grid');
    var board = document.querySelector('.board');
    var w = (board ? board.clientWidth : window.innerWidth - 28);
    var maxCols = w > 1120 ? 4 : (w > 780 ? 3 : 2);
    var n = Math.max(1, state.posts.length);
    var cols = Math.min(maxCols, n);
    var gap = w <= 780 ? 11 : 16;
    state.gap = gap;
    grid.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
    grid.style.columnGap = gap + 'px';
    grid.style.maxWidth = Math.min(w, cols * 340 + (cols - 1) * gap) + 'px';
    grid.style.margin = '0 auto';
    layoutMasonry();
  }

  var masonryTimer = null;
  function scheduleMasonry() {
    if (masonryTimer) clearTimeout(masonryTimer);
    masonryTimer = setTimeout(layoutMasonry, 90);
  }

  function layoutMasonry() {
    var grid = $('grid');
    var row = 4;
    var gap = state.gap || 16;
    Array.prototype.forEach.call(grid.children, function (card) {
      if (!card.classList || !card.classList.contains('card')) return;
      var h = card.offsetHeight;
      if (!h) return;
      card.style.gridRowEnd = 'span ' + Math.ceil((h + gap) / row);
    });
  }

  function renderSelBar() {
    var bar = $('selBar');
    var n = state.selected.size;
    if (!state.admin || n === 0) {
      bar.hidden = true;
      document.body.classList.remove('has-selbar');
      return;
    }
    bar.hidden = false;
    document.body.classList.add('has-selbar');
    $('selCount').textContent = n;
  }

  function setAdmin(on) {
    state.admin = on;
    document.body.classList.toggle('admin', on);
    $('adminBadge').hidden = !on;
    $('btnAdminLabel').textContent = on ? '나가기' : '관리자';
    if (!on) { state.selected.clear(); state.pass = ''; ssDel(KEYS.pass); }
    render();
  }

  /* ------------------------------------------------------------------ 불러오기 */
  function loadFirst() {
    var limit = Math.max(CONFIG.PAGE_SIZE, Math.min(state.posts.length, 60));
    if (state.mode === 'demo') {
      state.posts = demoLoad();
      state.loaded = true;
      render();
      return Promise.resolve();
    }
    return listPosts(limit, 0).then(function (rows) {
      exitDemo();
      state.posts = (rows || []).map(normalizePost);
      state.loaded = true;
      render();
    }).catch(function (err) {
      if (err.kind === 'offline' || err.kind === 'setup' || err.kind === 'network') {
        enterDemo(err.kind === 'setup' ? '사진 표가 아직 없습니다' : null);
        state.posts = demoLoad();
        state.loaded = true;
        render();
      } else {
        toast(err.message);
      }
    });
  }

  function normalizePost(r) {
    return {
      id: r.id,
      author: r.author || '',
      memo: r.memo || '',
      image_data: r.image_data || '',
      created_at: r.created_at || new Date().toISOString()
    };
  }

  function loadMore() {
    if (state.mode === 'demo') return;
    var btn = $('btnMore');
    btn.disabled = true;
    btn.textContent = '불러오는 중…';
    listPosts(CONFIG.PAGE_SIZE, state.posts.length).then(function (rows) {
      var seen = {};
      state.posts.forEach(function (p) { seen[p.id] = true; });
      (rows || []).forEach(function (r) {
        if (!seen[r.id]) { state.posts.push(normalizePost(r)); seen[r.id] = true; }
      });
      render();
    }).catch(function (err) {
      toast(err.message);
    }).then(function () {
      btn.disabled = false;
      btn.textContent = '더 보기';
      render();
    });
  }

  /* -------------------------------------------------------------------- 선택 */
  function toggleSelect(id) {
    if (!state.admin) return;
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    var card = document.querySelector('.card[data-id="' + id + '"]');
    if (card) card.classList.toggle('selected', state.selected.has(id));
    renderSelBar();
  }

  function clearSelection() {
    state.selected.clear();
    document.querySelectorAll('.card.selected').forEach(function (c) { c.classList.remove('selected'); });
    renderSelBar();
  }

  function selectedPosts() {
    return state.posts.filter(function (p) { return state.selected.has(p.id); });
  }

  /* -------------------------------------------------------------------- 삭제 */
  function deleteOne(id) {
    var post = postById(id);
    var label = post && post.author ? '‘' + post.author + '’ 님의 사진' : '이 사진';
    if (!window.confirm(label + '을(를) 삭제할까요? 되돌릴 수 없습니다.')) return;
    performDelete([id]);
  }

  function deleteSelected() {
    var ids = Array.from(state.selected);
    if (!ids.length) return;
    if (!window.confirm('고른 사진 ' + ids.length + '장을 삭제할까요? 되돌릴 수 없습니다.')) return;
    performDelete(ids);
  }

  function performDelete(ids) {
    var btn = $('btnSelDelete');
    if (btn) btn.disabled = true;

    function done(okCount) {
      if (btn) btn.disabled = false;
      if (okCount > 0) {
        state.posts = state.posts.filter(function (p) { return ids.indexOf(p.id) === -1; });
        ids.forEach(function (id) { state.selected.delete(id); });
        render();
        toast(okCount + '장을 삭제했습니다.');
      }
      if (okCount < ids.length) {
        toast((ids.length - okCount) + '장은 삭제하지 못했습니다. 비밀번호를 확인해 주세요.');
      }
    }

    if (state.mode === 'demo') {
      var demo = demoLoad().filter(function (p) { return ids.indexOf(p.id) === -1; });
      demoSave(demo);
      done(ids.length);
      return;
    }

    if (ids.length === 1) {
      rpc('photo_board_delete_post', { pass: state.pass, post_id: ids[0] })
        .then(function (res) { done(res === true ? 1 : 0); })
        .catch(function (err) { if (btn) btn.disabled = false; toast(err.message); });
      return;
    }

    rpc('photo_board_delete_posts', { pass: state.pass, post_ids: ids })
      .then(function (res) {
        var n = typeof res === 'number' ? res : Array.isArray(res) ? res.length : res === true ? ids.length : 0;
        done(n);
      })
      .catch(function (err) {
        if (btn) btn.disabled = false;
        toast(err.message);
      });
  }

  /* -------------------------------------------------------------------- 올리기 */
  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    var added = 0;
    files.forEach(function (file) {
      if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i.test(file.name)) return;
      if (file.size > CONFIG.MAX_FILE_MB * 1024 * 1024) {
        toast(file.name + ' — 파일이 너무 큽니다(최대 ' + CONFIG.MAX_FILE_MB + 'MB).');
        return;
      }
      state.picked.push({ file: file, url: URL.createObjectURL(file), err: '' });
      added++;
    });
    if (added) renderPicked();
  }

  function renderPicked() {
    var wrap = $('pickedWrap');
    var list = $('pickedList');
    if (!state.picked.length) {
      wrap.hidden = true;
      list.innerHTML = '';
      updateUploadBtn();
      return;
    }
    wrap.hidden = false;
    $('pickedCount').textContent = state.picked.length;
    list.innerHTML = state.picked.map(function (p, i) {
      return '<div class="picked-item" data-i="' + i + '">' +
        '<img src="' + p.url + '" alt="" />' +
        '<button type="button" aria-label="빼기">✕</button>' +
        '</div>';
    }).join('');
    updateUploadBtn();
  }

  function updateUploadBtn() {
    var ok = state.picked.length > 0 && $('authorInput').value.trim().length > 0 && !state.uploading;
    $('btnDoUpload').disabled = !ok;
    $('btnDoUpload').textContent = state.picked.length
      ? '올리기 (' + state.picked.length + '장)'
      : '올리기';
  }

  function openUpload() {
    if (state.uploading) return;
    $('authorInput').value = lsGet(KEYS.author) || '';
    $('memoInput').value = '';
    state.picked = [];
    renderPicked();
    updateUploadBtn();
    openOverlay('uploadSheet');
    setTimeout(function () { if (!$('authorInput').value) $('authorInput').focus(); }, 120);
  }

  function doUpload() {
    if (state.uploading) return;
    var author = $('authorInput').value.trim();
    var memo = $('memoInput').value.trim();
    if (!author) { toast('작성자 이름을 적어 주세요.'); $('authorInput').focus(); return; }
    if (!state.picked.length) { toast('올릴 사진을 골라 주세요.'); return; }

    state.uploading = true;
    lsSet(KEYS.author, author);
    $('btnDoUpload').disabled = true;
    var progress = $('uploadProgress');
    progress.hidden = false;
    var total = state.picked.length;
    var okCount = 0;
    var failed = 0;
    var queue = state.picked.slice();

    function setProgress(doneCount, text) {
      var pct = Math.round((doneCount / total) * 100);
      $('progressFill').style.width = pct + '%';
      $('progressText').textContent = text || ('올리는 중… ' + doneCount + ' / ' + total);
    }

    function step(i) {
      if (i >= queue.length) {
        state.uploading = false;
        progress.hidden = true;
        setProgress(total, '');
        state.picked = [];
        renderPicked();
        if (okCount > 0) {
          closeOverlay('uploadSheet');
          toast(okCount + '장을 올렸습니다.' + (failed ? ' (' + failed + '장 실패)' : ''));
          loadFirst();
        } else {
          toast('올리지 못했습니다. 다시 시도해 주세요.');
        }
        return;
      }
      var item = queue[i];
      setProgress(i, '사진을 줄이는 중… ' + (i + 1) + ' / ' + total);

      compressImage(item.file).then(function (res) {
        var row = {
          author: author,
          memo: memo,
          image_data: res.dataUrl
        };
        if (state.mode === 'demo') {
          row.id = uuid();
          row.created_at = new Date().toISOString();
          var demo = demoLoad();
          demo.unshift(row);
          demoSave(demo);
          okCount++;
          step(i + 1);
          return;
        }
        setProgress(i, '서버에 올리는 중… ' + (i + 1) + ' / ' + total);
        insertPost(row).then(function () {
          okCount++;
          step(i + 1);
        }).catch(function (err) {
          if (err.kind === 'offline') { enterDemo(); }
          failed++;
          step(i + 1);
        });
      }).catch(function () {
        failed++;
        step(i + 1);
      });
    }

    step(0);
  }

  /* ------------------------------------------------------------------ 라이트박스 */
  function openLightbox(index) {
    if (index < 0 || index >= state.posts.length) return;
    state.lightboxIndex = index;
    var p = state.posts[index];
    var img = $('lbImg');
    img.src = p.image_data;
    img.alt = (p.author || '익명') + ' 님이 올린 사진';
    $('lbAuthor').textContent = (p.author || '').trim() || '익명';
    $('lbMemo').textContent = (p.memo || '').trim();
    $('lbDate').textContent = fmtFull(p.created_at);
    $('lbPrev').hidden = index <= 0;
    $('lbNext').hidden = index >= state.posts.length - 1;
    openOverlay('lightbox');
  }

  function moveLightbox(delta) {
    var next = state.lightboxIndex + delta;
    if (next < 0 || next >= state.posts.length) return;
    openLightbox(next);
  }

  /* -------------------------------------------------------------------- 인쇄 */
  function chunk(list, n) {
    var out = [];
    for (var i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
    return out;
  }

  function buildSheet(posts, per, opts) {
    var sheet = el('section', 'sheet p' + per);
    sheet.classList.add(opts.cover ? 'fit-cover' : 'fit-contain');
    if (!opts.showName) sheet.classList.add('hide-name');
    posts.forEach(function (p) {
      var fig = el('figure', 'cell');
      var ph = el('div', 'ph');
      var img = document.createElement('img');
      img.src = p.image_data;
      img.alt = (p.author || '').trim() || '사진';
      ph.appendChild(img);
      fig.appendChild(ph);
      if (opts.showName) {
        var cap = document.createElement('figcaption');
        cap.textContent = (p.author || '').trim() || '익명';
        fig.appendChild(cap);
      }
      sheet.appendChild(fig);
    });
    return sheet;
  }

  function pagesFor(posts, per) {
    var n = Array.isArray(posts) ? posts.length : parseInt(posts, 10) || 0;
    return Math.max(1, Math.ceil(n / per));
  }

  /* 사진 상자(.ph)를 사진의 실제 비율에 맞춰 줄여, 이름표가 사진 바로 아래에 붙게 한다.
     (꽉 채우기 모드에서는 상자를 그대로 채우므로 건드리지 않는다) */
  function layoutSheets(scope) {
    if (!scope) return;
    Array.prototype.slice.call(scope.querySelectorAll('.sheet')).forEach(function (sheet) {
      if (sheet.classList.contains('fit-cover')) return;
      Array.prototype.slice.call(sheet.querySelectorAll('.cell')).forEach(function (cell) {
        var ph = cell.querySelector('.ph');
        var img = ph && ph.querySelector('img');
        if (!img || !img.naturalWidth || !img.naturalHeight) return;
        var availW = ph.clientWidth;
        var availH = ph.clientHeight;
        if (!availW || !availH) return;
        var s = Math.min(availW / img.naturalWidth, availH / img.naturalHeight);
        var w = Math.max(1, Math.floor(img.naturalWidth * s));
        var h = Math.max(1, Math.floor(img.naturalHeight * s));
        img.style.width = w + 'px';
        img.style.height = h + 'px';
        img.style.maxWidth = 'none';
        img.style.maxHeight = 'none';
        ph.style.flex = '0 0 auto';
        ph.style.width = '100%';
        ph.style.height = h + 'px';
      });
    });
  }

  function renderPreview() {
    var host = $('previewHost');
    var posts = selectedPosts();
    host.innerHTML = '';
    if (!posts.length) return;

    var pages = pagesFor(posts, state.per);
    $('previewNote').textContent = '총 ' + pages + '장 · ' + state.per + '장씩';
    var first = buildSheet(posts.slice(0, state.per), state.per, { showName: state.showName, cover: state.cover });

    var scaler = el('div', 'preview-scaler');
    scaler.appendChild(first);
    host.appendChild(scaler);

    var scaleImgs = Array.prototype.slice.call(first.querySelectorAll('img'));
    Promise.all(scaleImgs.map(function (img) {
      if (img.decode) return img.decode().catch(function () {});
      return Promise.resolve();
    })).then(function () {
      layoutSheets(first);
      fitPreview(first, scaler, host);
    });

    fitPreview(first, scaler, host);
  }

  function fitPreview(first, scaler, host) {
    var mm = 96 / 25.4;
    var sheetW = 210 * mm;
    var sheetH = 296.8 * mm;
    var availW = Math.max(160, host.clientWidth - 24);
    var maxH = window.innerWidth <= 720 ? 210 : 240;
    var scale = Math.min(1, availW / sheetW, maxH / sheetH);
    first.style.transform = 'scale(' + scale + ')';
    scaler.style.width = (sheetW * scale) + 'px';
    scaler.style.height = (sheetH * scale) + 'px';
  }

  function openPrint() {
    if (!selectedPosts().length) { toast('인쇄할 사진을 먼저 골라 주세요.'); return; }
    document.querySelectorAll('.layout-opt').forEach(function (b) {
      b.setAttribute('aria-checked', String(parseInt(b.dataset.per, 10) === state.per));
    });
    $('optName').checked = state.showName;
    $('optCover').checked = state.cover;
    $('printCount').textContent = selectedPosts().length;
    $('printPages').textContent = pagesFor(selectedPosts(), state.per);
    openOverlay('printSheet');
    requestAnimationFrame(renderPreview);
  }

  function updatePrintSummary() {
    var n = selectedPosts().length;
    $('printCount').textContent = n;
    $('printPages').textContent = pagesFor(n, state.per);
    renderPreview();
  }

  function doPrint() {
    var posts = selectedPosts();
    if (!posts.length) { toast('인쇄할 사진을 골라 주세요.'); return; }

    var root = $('printRoot');
    root.innerHTML = '';
    var pages = chunk(posts, state.per);
    var opts = { showName: state.showName, cover: state.cover };
    pages.forEach(function (group) { root.appendChild(buildSheet(group, state.per, opts)); });

    var imgs = Array.prototype.slice.call(root.querySelectorAll('img'));
    var ready = Promise.all(imgs.map(function (img) {
      if (img.decode) return img.decode().catch(function () {});
      return Promise.resolve();
    }));

    var prevTitle = document.title;
    document.title = '사진보드_' + ymdToday() + '_' + posts.length + '장_' + state.per + '장씩';

    ready.then(function () {
      layoutSheets(root);
      setTimeout(function () {
        window.print();
        setTimeout(function () { document.title = prevTitle; }, 1500);
      }, 150);
    });
  }

  /* ------------------------------------------------------------------ 오버레이 */
  function openOverlay(id) {
    $(id).hidden = false;
    document.body.classList.add('modal-open');
  }

  function closeOverlay(id) {
    if (id === 'uploadSheet' && state.uploading) return;
    $(id).hidden = true;
    if (!document.querySelector('.overlay:not([hidden])')) document.body.classList.remove('modal-open');
    if (id === 'lightbox') { state.lightboxIndex = -1; $('lbImg').src = ''; }
    if (id === 'printSheet') $('previewHost').innerHTML = '';
    if (id === 'adminSheet') { $('adminPass').value = ''; $('adminError').hidden = true; }
  }

  function closeAllOverlays() {
    Array.prototype.slice.call(document.querySelectorAll('.overlay:not([hidden]), .lightbox:not([hidden])'))
      .forEach(function (o) { closeOverlay(o.id); });
  }

  /* -------------------------------------------------------------------- 관리자 */
  function openAdmin() {
    if (state.admin) { setAdmin(false); toast('관리자 모드에서 나왔습니다.'); return; }
    var sheet = $('adminSheet');
    var demoNote = sheet.querySelector('.demo-note');
    if (state.mode === 'demo') {
      if (!demoNote) {
        demoNote = el('div', 'field-hint demo-note');
        sheet.querySelector('.sheet-lead').after(demoNote);
      }
      demoNote.innerHTML = '<strong>체험 모드</strong>에서는 비밀번호 없이 관리자 화면을 볼 수 있습니다. ' +
        '(이 브라우저에만 저장된 사진이라 실제 공유 사진은 지워지지 않습니다.)';
      $('adminPass').closest('.field').hidden = true;
      $('btnUnlock').textContent = '체험 모드로 열기';
    } else {
      if (demoNote) demoNote.remove();
      $('adminPass').closest('.field').hidden = false;
      $('btnUnlock').textContent = '들어가기';
    }
    $('adminPass').value = '';
    $('adminError').hidden = true;
    openOverlay('adminSheet');
    if (state.mode !== 'demo') setTimeout(function () { $('adminPass').focus(); }, 120);
  }

  function tryUnlock(ev) {
    if (ev) ev.preventDefault();
    if (state.mode === 'demo') {
      setAdmin(true);
      closeOverlay('adminSheet');
      toast('관리자 모드입니다. 사진을 눌러 고르세요.');
      return;
    }
    var pass = $('adminPass').value;
    if (!pass) { $('adminPass').focus(); return; }
    var btn = $('btnUnlock');
    btn.disabled = true;
    btn.textContent = '확인 중…';
    $('adminError').hidden = true;

    rpc('photo_board_unlock', { pass: pass }).then(function (res) {
      btn.disabled = false;
      btn.textContent = '들어가기';
      if (res === true) {
        state.pass = pass;
        ssSet(KEYS.pass, pass);
        setAdmin(true);
        closeOverlay('adminSheet');
        toast('관리자 모드입니다. 사진을 눌러 고르세요.');
      } else {
        $('adminError').hidden = false;
        $('adminError').textContent = '비밀번호가 맞지 않습니다.';
        $('adminPass').select();
      }
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = '들어가기';
      if (err.kind === 'offline') {
        enterDemo();
        toast('서버에 연결하지 못했습니다. 체험 모드로 바꿨습니다.');
        closeOverlay('adminSheet');
      } else {
        $('adminError').hidden = false;
        $('adminError').textContent = err.message + (err.detail ? ' — ' + err.detail.slice(0, 120) : '');
      }
    });
  }

  /* -------------------------------------------------------------------- 샘플 */
  function seedDemoPhotos() {
    var samples = [
      { t: '운동회 단체 사진', a: '홍길동', w: 1600, h: 1200, c1: '#7FA8C9', c2: '#3F6B5B' },
      { t: '가을 소풍', a: '김철수', w: 1200, h: 1600, c1: '#E0B183', c2: '#A0584A' },
      { t: '현장학습', a: '3학년 2반', w: 1400, h: 1400, c1: '#C8B6D9', c2: '#6A5D8C' },
      { t: '체험 학습 발표', a: '이영희', w: 1600, h: 900, c1: '#B7D3B0', c2: '#4F7C7A' }
    ];
    var demo = demoLoad();
    samples.forEach(function (s, i) {
      var c = document.createElement('canvas');
      c.width = s.w; c.height = s.h;
      var ctx = c.getContext('2d');
      var g = ctx.createLinearGradient(0, 0, s.w, s.h);
      g.addColorStop(0, s.c1); g.addColorStop(1, s.c2);
      ctx.fillStyle = g; ctx.fillRect(0, 0, s.w, s.h);
      ctx.fillStyle = 'rgba(255,255,255,.82)';
      ctx.beginPath();
      ctx.arc(s.w * 0.7, s.h * 0.32, Math.min(s.w, s.h) * 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.95)';
      ctx.textAlign = 'center';
      ctx.font = '700 ' + Math.round(Math.min(s.w, s.h) * 0.1) + 'px sans-serif';
      ctx.fillText(String(i + 1), s.w / 2, s.h * 0.6);
      demo.unshift({
        id: uuid(),
        author: s.a,
        memo: s.t,
        image_data: c.toDataURL('image/jpeg', 0.8),
        created_at: new Date(Date.now() - i * 3600 * 1000).toISOString()
      });
    });
    demoSave(demo);
    loadFirst();
    toast('샘플 사진 4장을 넣었습니다. 관리자 모드에서 인쇄를 눌러 보세요.');
  }

  /* -------------------------------------------------------------------- 이벤트 */
  function bind() {
    $('btnUpload').addEventListener('click', openUpload);
    $('btnUploadEmpty').addEventListener('click', openUpload);
    $('fab').addEventListener('click', openUpload);
    $('btnAdmin').addEventListener('click', openAdmin);
    $('btnRefresh').addEventListener('click', function () {
      loadFirst().then(function () { toast('새로고침했습니다.'); });
    });
    $('btnMore').addEventListener('click', loadMore);
    $('btnSeed').addEventListener('click', seedDemoPhotos);

    // 오버레이 닫기
    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { closeOverlay(b.dataset.close); });
    });
    document.querySelectorAll('.overlay').forEach(function (o) {
      o.addEventListener('mousedown', function (e) { if (e.target === o) closeOverlay(o.id); });
    });

    // 파일 고르기
    var dz = $('dropZone');
    var input = $('fileInput');
    dz.addEventListener('click', function () { input.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); });
    });
    dz.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });
    input.addEventListener('change', function () { addFiles(input.files); input.value = ''; });
    $('btnPickMore').addEventListener('click', function () { input.click(); });

    $('pickedList').addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      var item = btn.closest('.picked-item');
      var i = parseInt(item.dataset.i, 10);
      try { URL.revokeObjectURL(state.picked[i].url); } catch (err) {}
      state.picked.splice(i, 1);
      renderPicked();
    });

    $('authorInput').addEventListener('input', updateUploadBtn);
    $('authorInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('memoInput').focus(); });
    $('memoInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') doUpload(); });
    $('btnDoUpload').addEventListener('click', doUpload);

    // 관리자
    $('adminForm').addEventListener('submit', tryUnlock);

    // 카드
    $('grid').addEventListener('click', function (e) {
      var card = e.target.closest('.card');
      if (!card) return;
      var id = card.dataset.id;
      var tool = e.target.closest('.tool-btn');
      if (tool) {
        e.stopPropagation();
        if (tool.dataset.act === 'view') openLightbox(parseInt(card.dataset.index, 10));
        if (tool.dataset.act === 'delete') deleteOne(id);
        return;
      }
      if (state.admin) toggleSelect(id);
      else openLightbox(parseInt(card.dataset.index, 10));
    });

    // 선택 바
    $('btnSelClear').addEventListener('click', clearSelection);
    $('btnSelDelete').addEventListener('click', deleteSelected);
    $('btnSelPrint').addEventListener('click', openPrint);

    // 인쇄 설정
    $('layoutGrid').addEventListener('click', function (e) {
      var b = e.target.closest('.layout-opt');
      if (!b) return;
      state.per = parseInt(b.dataset.per, 10);
      lsSet(KEYS.per, String(state.per));
      document.querySelectorAll('.layout-opt').forEach(function (o) {
        o.setAttribute('aria-checked', String(o === b));
      });
      updatePrintSummary();
    });
    $('optName').addEventListener('change', function () {
      state.showName = this.checked;
      lsSet(KEYS.showName, this.checked ? '1' : '0');
      renderPreview();
    });
    $('optCover').addEventListener('change', function () {
      state.cover = this.checked;
      lsSet(KEYS.cover, this.checked ? '1' : '0');
      renderPreview();
    });
    $('btnDoPrint').addEventListener('click', doPrint);

    // 라이트박스
    $('lbPrev').addEventListener('click', function () { moveLightbox(-1); });
    $('lbNext').addEventListener('click', function () { moveLightbox(1); });

    // 키보드
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var lb = $('lightbox');
        if (!lb.hidden) { closeOverlay('lightbox'); return; }
        closeAllOverlays();
        return;
      }
      if (!$('lightbox').hidden) {
        if (e.key === 'ArrowLeft') moveLightbox(-1);
        if (e.key === 'ArrowRight') moveLightbox(1);
      }
    });

    // 화면 크기 변경 시 미리보기 다시
    var rt = null;
    window.addEventListener('resize', function () {
      applyColumns();
      if ($('printSheet').hidden) return;
      if (rt) clearTimeout(rt);
      rt = setTimeout(renderPreview, 150);
    });
    // 새 사진 자동 확인
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && state.loaded) pollOnce();
    });
    state.polling = setInterval(function () {
      if (document.visibilityState !== 'visible') return;
      if (document.querySelector('.overlay:not([hidden])')) return;
      pollOnce();
    }, CONFIG.POLL_MS);
  }

  function pollOnce() {
    if (state.mode === 'demo') return;
    countPosts().then(function (n) {
      if (n == null) return;
      if (n !== state.posts.length) loadFirst();
    });
  }

  /* -------------------------------------------------------------------- 시작 */
  function boot() {
    var savedPass = ssGet(KEYS.pass) || '';
    if (savedPass) { state.pass = savedPass; state.admin = true; }

    bind();
    if (state.admin) {
      document.body.classList.add('admin');
      $('adminBadge').hidden = false;
      $('btnAdminLabel').textContent = '나가기';
    }
    loadFirst().then(function () {
      window.__pbReady = true;
      window.__pbMode = state.mode;
    });
  }

  // 바깥에서 검사할 수 있게 최소한만 노출
  window.__pb = {
    state: state,
    loadFirst: loadFirst,
    pagesFor: pagesFor
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
