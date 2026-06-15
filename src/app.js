// Main application logic
// HTML 转义别名 — 复用 ai.js 中的 _aiEscape，防御 XSS
var esc = typeof _aiEscape === 'function' ? _aiEscape : function(s) { if (!s) return ''; return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
let questions = [];
let currentTab = 'practice';
let currentQuestion = null;
let answerLocked = false;
let userAnswers = [];
let sources = [];
let _totalQuestions = 0;  // total question count (for display), grows as bg load finishes
let _fullBankPromise = null;
let _topicQs = [];       // 缓存：有 tag 的专题题
let _untaggedQs = [];    // 缓存：无 tag 的基础题
var _qMap = new Map();   // id → question 哈希索引，O(1) 替代 Array.find

function getQ(id) { return _qMap.get(id); }

// 同步 _qMap 与 questions 数组（questions 变更后调用）
function _rebuildQMap() {
  _qMap.clear();
  for (var i = 0; i < questions.length; i++) {
    _qMap.set(questions[i].id, questions[i]);
  }
}

function _updateLoadProgress(current, total, indeterminate) {
  var wrap = document.getElementById('load-progress-wrap');
  var bar = document.getElementById('load-progress-bar');
  if (!wrap || !bar) return;
  var txt = document.getElementById('load-progress-text');
  if (indeterminate) {
    wrap.style.display = 'block';
    if (txt) txt.style.display = 'block';
    bar.classList.add('indeterminate');
    bar.style.width = '';
  } else {
    bar.classList.remove('indeterminate');
    if (current >= total) {
      wrap.style.display = 'none';
      if (txt) txt.style.display = 'none';
    } else {
      wrap.style.display = 'block';
      if (txt) txt.style.display = 'block';
      bar.style.width = (current / total * 100).toFixed(1) + '%';
    }
  }
}

function _refreshPools() {
  _topicQs = questions.filter(function(q) { return q.tags && q.tags[0]; });
  _untaggedQs = questions.filter(function(q) { return !q.tags || !q.tags[0]; });
  _rebuildQMap();
}

// Topic list for filtered practice mode
const TOPICS = [
  '作者精选题库',
  '习近平新时代中国特色社会主义思想',
  '党的二十大精神',
  '党的二十届四中全会精神',
  '中国共产党党史',
  '中国共产党章程',
  '中国共产党纪律处分条例',
  '树立和践行正确政绩观学习教育',
  '重庆大学发展党员工作要求',
  '综合补充',
  '综合易错',
  '综合老题库',
  '中央八项规定精神'
];

// Shared topic dropdown builder — avoids 4× duplicated HTML+JS
function buildTopicDropdownHTML(idSuffix, selectedVal, showAll, showOther) {
  var buttonText = showAll ? '全部' : (esc(selectedVal) || '请选择');
  var html = '<div class="topic-dropdown" id="topic-dropdown-' + idSuffix + '">';
  html += '<button class="topic-dropdown-btn" id="topic-dropdown-btn-' + idSuffix + '"><span>' + buttonText + '</span><span class="topic-dropdown-arrow"></span></button>';
  html += '<div class="topic-dropdown-panel" id="topic-dropdown-panel-' + idSuffix + '">';
  if (showAll) {
    html += '<button class="topic-option' + (selectedVal === 'all' ? ' active' : '') + '" data-topic-val="all">全部</button>';
  }
  for (var t = 0; t < TOPICS.length; t++) {
    var active = (selectedVal === TOPICS[t]) ? ' active' : '';
    html += '<button class="topic-option' + active + '" data-topic-val="' + TOPICS[t] + '">' + (t + 1) + '. ' + TOPICS[t] + '</button>';
  }
  if (showOther) {
    html += '<button class="topic-option" data-topic-val="other">综合老题库</button>';
  }
  html += '</div></div>';
  return html;
}

function bindTopicDropdown(idSuffix, onSelect) {
  var btn = document.getElementById('topic-dropdown-btn-' + idSuffix);
  var panel = document.getElementById('topic-dropdown-panel-' + idSuffix);
  if (!btn || !panel) return;
  btn.addEventListener('click', function(e) { e.stopPropagation(); panel.classList.toggle('open'); });
  panel.querySelectorAll('.topic-option').forEach(function(opt) {
    opt.addEventListener('click', function(e) {
      e.stopPropagation(); panel.classList.remove('open');
      btn.querySelector('span').textContent = this.textContent;
      panel.querySelectorAll('.topic-option').forEach(function(o) { o.classList.remove('active'); });
      this.classList.add('active');
      onSelect(this.dataset.topicVal);
    });
  });
}

// Parse a range of compact rows into question objects
function parseRows(rows, start, end) {
  var result = [];
  for (var i = start; i < end; i++) {
    var R = rows[i], kc = R.length - 5, opts = [];
    for (var j = 0; j < kc; j++) opts.push({key: String.fromCharCode(65 + j), text: R[3 + j]});
    result.push({
      id: 'q_' + String(i + 1).padStart(6, '0'),
      type: R[0] === 0 ? 'single' : 'multiple',
      question: R[1], options: opts,
      answer: R[R.length - 2].split('').filter(Boolean),
      source: sources[R[R.length - 1]] || '',
      tags: R[2] ? [R[2]] : ['']
    });
  }
  return result;
}

// Fallback: load questions.js via <script> injection (file:// protocol)
function loadViaScript() {
  return new Promise(function(resolve, reject) {
    if (typeof _D !== 'undefined') { resolve(_D); return; }
    var s = document.createElement('script');
    s.src = 'questions.js';
    var settled = false;
    var timer = setTimeout(function() {
      if (!settled) { settled = true; reject(new Error('questions.js load timed out')); }
    }, 15000);
    s.onload = function() {
      if (!settled) { settled = true; clearTimeout(timer); resolve(_D); }
    };
    s.onerror = function() {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error('questions.js not found')); }
    };
    document.head.appendChild(s);
  });
}

// Load full question bank in background chunks (non-blocking)
function loadQuestions(showError) {
  var app = document.getElementById('app');
  var CHUNK = 500;

  function fetchBank() {
    var bankUrl = window.__QUESTION_BANK_URL || 'questions-compact.json';
    return fetch(new URL(bankUrl, location.href).href, {mode: 'cors'})
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(d) { return d; });
  }

  function processAll(rows, onChunk) {
    return new Promise(function(resolve) {
      sources = sources.length ? sources : [];  // keep preloaded sources if present
      _totalQuestions = rows.length;
      var idx = 0;
      function next() {
        var end = Math.min(idx + CHUNK, rows.length);
        var batch = parseRows(rows, idx, end);
        if (onChunk) onChunk(batch);
        idx = end;
        if (idx < rows.length) { requestAnimationFrame(next); }
        else { resolve(); }
      }
      next();
    });
  }

  // 增量合并回调：processAll 每批处理完立即合入 questions
  function _mergeChunk(batch) {
    for (var i = 0; i < batch.length; i++) { questions.push(batch[i]); }
    _refreshPools();
    updateStatsBar();
    _updateLoadProgress(questions.length, _totalQuestions);
  }

  return fetchBank()
    .then(function(d) {
      sources = d.s;
      questions = [];
      // 不立即 _refreshPools()：保留 _qMap/_topicQs/_untaggedQs 中的预加载数据
      // _mergeChunk 的第一个 chunk 会调用 _refreshPools() 正确重建
      return processAll(d.q, _mergeChunk);
    })
    .catch(function() {
      // Fallback: script injection (file:// 协议等场景)
      return loadViaScript().then(function(raw) {
        var d = typeof raw === 'string' ? JSON.parse(raw) : raw;
        sources = d.s;
        questions = [];
        // 同上：保留预加载缓存，_mergeChunk 会重建
        return processAll(d.q, _mergeChunk);
      }).catch(function() {
        // 兜底：保留预加载数据，不清空
        if (showError) {
          app.innerHTML = '<div class="empty-state">题库加载失败，请刷新页面重试</div>';
        }
        throw new Error('All loading paths failed');
      });
    });
}

function loadFullQuestionBank(showError) {
  if (_fullBankPromise) return _fullBankPromise;
  _updateLoadProgress(0, 1, true); // 下载阶段：流动动画
  _fullBankPromise = loadQuestions(showError).then(function() {
    // 增量合并已在 processAll 中完成，此处仅恢复 currentQuestion 引用
    if (currentQuestion) {
      currentQuestion = getQ(currentQuestion.id) || currentQuestion;
    }
    // 后台补全：不重渲染整个页面，只刷新统计数字
    if (currentTab === 'practice') {
      _updateProgressText();
    } else if (showError) {
      if (currentTab === 'all') { renderAllQuestions(); }
      else if (currentTab === 'wrong') { renderWrongList(); }
      else if (currentTab === 'fav') { renderFavList(); }
      else if (currentTab === 'exam' && !examState) { renderExamStart(); }
    }
    (new Image()).src = 'wechat.png';
    return questions;
  }).catch(function(e) {
    _updateLoadProgress(1, 1); // 隐藏进度条
    _fullBankPromise = null;
    if (showError) throw e;
    console.warn('Question bank background load failed:', e);
    return questions;
  });
  return _fullBankPromise;
}

function scheduleAfterFirstPaint(fn) {
  var runIdle = function() {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(fn, {timeout: 2400});
    } else {
      setTimeout(fn, 0);
    }
  };
  var runAfterPaint = function() {
    setTimeout(runIdle, 900);
  };
  if ('requestAnimationFrame' in window) {
    requestAnimationFrame(function() {
      requestAnimationFrame(runAfterPaint);
    });
  } else {
    setTimeout(runIdle, 900);
  }
}

function showUpdateBar() {
  var bar = document.getElementById('sw-update-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'sw-update-bar';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999;background:var(--accent);color:#fff;text-align:center;padding:10px 16px;font-size:14px;cursor:pointer;font-weight:500;';
    bar.textContent = '新版本已就绪，点击刷新';
    bar.addEventListener('click', function() {
      location.reload();
    });
    document.body.prepend(bar);
  }
}

function checkVersion() {
  fetch('version.txt?t=' + Date.now(), {cache: 'no-cache'}).then(function(r) { return r.text(); }).then(function(remoteVer) {
    remoteVer = remoteVer.trim();
    if (remoteVer.length > 50 || !remoteVer) return; // 防404误报 / 空内容
    var localVer = window.__VERSION || '';
    if (localVer && remoteVer !== localVer) {
      showUpdateBar();
    }
  }).catch(function() {});
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'new-version') showUpdateBar();
  });
  navigator.serviceWorker.register('sw.js', {updateViaCache: 'none'}).then(function(registration) {
    registration.update().catch(function() {});
  }).catch(function(e) {
    console.warn('Service worker registration failed:', e);
  });
  // Page-level version check as fallback
  scheduleAfterFirstPaint(function() { checkVersion(); });
}

// Initialize from inlined preload data (zero-wait first render)
function initFromPreload() {
  if (!window.__PRELOAD) return false;
  var d = window.__PRELOAD;
  sources = d.s;
  _totalQuestions = d.t;
  questions = parseRows(d.q, 0, d.q.length);
  // 用原始位置修正 ID，保证与全量加载一致
  var idxs = d._idx || [];
  for (var i = 0; i < Math.min(questions.length, idxs.length); i++) {
    questions[i].id = 'q_' + String(idxs[i] + 1).padStart(6, '0');
  }
  _refreshPools();
  delete window.__PRELOAD;
  return true;
}

// 检测预加载数据是否覆盖当前保存的练习位置
function _preloadInsufficient() {
  if (_totalQuestions <= questions.length) return false;
  var mode = Storage.getMode();
  if (mode === 'topic') {
    var pool = getTopicPool();
    if (!pool.length) return true;
    return Storage.getTopicIdx() >= pool.length;
  }
  if (mode === 'sequential') {
    return Storage.getSequentialIdx() >= questions.length;
  }
  return false;
}

// 后台补全后静默刷新题目进度文字（不重渲染）
function _updateProgressText() {
  var el = document.querySelector('.progress-info');
  if (!el || !currentQuestion) return;
  var mode = Storage.getMode();
  if (mode === 'topic') {
    var pool = getTopicPool();
    var idx = pool.indexOf(currentQuestion);
    if (idx >= 0) el.textContent = '专题 · 第 ' + (idx + 1) + '/' + pool.length + ' 题';
  } else if (mode === 'sequential') {
    var i = questions.indexOf(currentQuestion);
    if (i >= 0) el.textContent = '顺序 · 第 ' + (i + 1) + '/' + _totalQuestions + ' 题';
  }
}

// Replace questions with full bank, preserving currentQuestion
function mergeFullBank(fullQuestions) {
  var curId = currentQuestion ? currentQuestion.id : null;
  questions = fullQuestions;
  _totalQuestions = fullQuestions.length;
  _refreshPools();
  if (curId) {
    currentQuestion = getQ(curId) || currentQuestion;
  }
}

// Navigation
// Dark mode
function initDarkMode() {
  var stored = localStorage.getItem('cquccp_dark');
  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var isDark = stored === '1' || (!stored && prefersDark);
  applyDarkMode(isDark);
  var toggle = document.getElementById('dark-toggle');
  if (toggle) {
    toggle.addEventListener('click', function() {
      var nowDark = document.documentElement.dataset.theme !== 'dark';
      applyDarkMode(nowDark);
      localStorage.setItem('cquccp_dark', nowDark ? '1' : '0');
    });
  }
}
function applyDarkMode(on) {
  document.documentElement.dataset.theme = on ? 'dark' : '';
}

document.addEventListener('DOMContentLoaded', function() {
  initDarkMode();
  setupNav();
  setupSponsorNavigation();
  registerServiceWorker();

  var hasPreload = initFromPreload();
  if (hasPreload) {
    // Render immediately with preloaded data, delay full bank fetch to not compete with first paint
    if (_preloadInsufficient()) {
      document.getElementById('app').innerHTML = '';
      loadFullQuestionBank(false).then(function() { renderInitialRoute(); });
    } else {
      renderInitialRoute();
      setTimeout(function() { loadFullQuestionBank(false); }, 200);
    }
  } else if (isSponsorRoute()) {
    renderInitialRoute();
  } else {
    // No preload: first render waits for the question bank.
    loadFullQuestionBank(true).then(function() {
      renderInitialRoute();
    }).catch(function(e) { /* already handled */ });
  }
});

function setupNav() {
  document.querySelectorAll('#top-nav button').forEach(btn => {
    btn.addEventListener('click', () => {
      clearSponsorHash();
      showTab(btn.dataset.tab);
    });
  });
}

function setupSponsorNavigation() {
  window.addEventListener('hashchange', function() {
    if (isSponsorRoute()) {
      showSponsorPage();
    } else if (currentTab === 'sponsor') {
      // 从赞助页离开（浏览器后退 / 手动改 hash），恢复到之前标签
      var lastTab = '';
      try { lastTab = sessionStorage.getItem('cquccp_last_tab') || ''; } catch(e) {}
      if (lastTab === 'sponsor') lastTab = 'practice';
      showTab(lastTab || 'practice');
    }
  });
}

function isSponsorRoute() {
  return location.hash === '#sponsor';
}

function renderInitialRoute() {
  if (isSponsorRoute()) {
    showSponsorPage();
    return;
  }
  // Restore last tab
  var lastTab = '';
  try { lastTab = sessionStorage.getItem('cquccp_last_tab') || ''; } catch(e) {}
  if (lastTab === 'exam') {
    var draft = loadExamDraft();
    if (draft && draft.qids && draft.qids.length) {
      if (_totalQuestions > questions.length) {
        loadFullQuestionBank(false).then(function() { renderInitialRoute(); });
        return;
      }
      if (questions.length >= 50) {
      // Auto-resume exam
      var qs = draft.qids.map(function(id) { return getQ(id); }).filter(Boolean);
      if (qs.length) {
        // 旧版考试草稿（非50题分布）直接清除
        if (qs.length !== 50) {
          clearExamDraft();
          showTab('exam');
          return;
        }
        if (examState && examState.timerInterval) clearInterval(examState.timerInterval);
        examState = {
          questions: qs,
          answers: draft.answers || {},
          marked: draft.marked || {},
          startTime: Date.now() - ((draft.elapsed || 0) * 1000),
          timerInterval: null,
          submitted: false,
          currentIdx: draft.currentIdx || 0
        };
        examState.timerInterval = setInterval(function() {
          var elapsed = Math.floor((Date.now() - examState.startTime) / 1000);
          var timerEl = document.getElementById('exam-timer');
          if (timerEl) timerEl.textContent = formatTime(elapsed);
        }, 1000);
        currentTab = 'exam';
        setActiveNav('exam');
        renderExamUI();
        return;
      } else {
        // 草稿中所有 qid 均已过期，清除无效草稿
        clearExamDraft();
      }
      }
    }
    // Exam draft invalid, show exam start
    showTab('exam');
    return;
  }
  showTab(lastTab || 'practice');
}

function clearSponsorHash() {
  if (isSponsorRoute() && history.replaceState) {
    history.replaceState(null, '', location.pathname + location.search);
  }
}

function setActiveNav(tab) {
  document.querySelectorAll('#top-nav button').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
}

function confirmLeaveExam() {
  if (!examState || examState.submitted) return true;
  if (!confirm('正在考试中，进度已自动保存，确定离开吗？')) return false;
  if (_examSaveTimer) { clearTimeout(_examSaveTimer); _examSaveTimer = null; }
  if (_examAutoAdvanceTimer) { clearTimeout(_examAutoAdvanceTimer); _examAutoAdvanceTimer = null; }
  saveExamDraft();
  clearInterval(examState.timerInterval);
  examState = null;
  return true;
}

function showTab(tab) {
  if (tab !== 'exam' && !confirmLeaveExam()) {
    setActiveNav('exam');
    return;
  }
  AIPanel.close();
  currentTab = tab;
  try { sessionStorage.setItem('cquccp_last_tab', tab); } catch(e) {}
  setActiveNav(tab);
  const app = document.getElementById('app');
  if (tab !== 'exam') { examState = null; }
  switch (tab) {
    case 'practice': renderPractice(); break;
    case 'exam': renderExam(); break;
    case 'all': renderAllQuestions(); break;
    case 'wrong': renderWrongList(); break;
    case 'fav': renderFavList(); break;
  }
}

function showSponsorPage() {
  if (!confirmLeaveExam()) {
    setActiveNav('exam');
    clearSponsorHash();
    return;
  }
  currentTab = 'sponsor';
  examState = null;
  setActiveNav(null);
  const app = document.getElementById('app');
  app.innerHTML = `
    <section class="sponsor-page" aria-labelledby="sponsor-title">
      <button class="btn btn-sm sponsor-back" id="btn-sponsor-back">← 返回练习</button>
      <div class="sponsor-hero">
        <span class="sponsor-heart" aria-hidden="true"><span class="sponsor-heart-emoji">💖</span></span>
        <h1 id="sponsor-title">友情赞助</h1>
        <p>如果有帮助的话，感谢支持维护🥰</p>
        <p>如果遗憾没帮助，我会努力改善🥹</p>
      </div>
      <div class="sponsor-qr-card">
        <img src="wechat.png" alt="微信收款码" width="410" height="440">
      </div>
    </section>
  `;
  document.getElementById('btn-sponsor-back').addEventListener('click', function() {
    clearSponsorHash();
    var lastTab = '';
    try { lastTab = sessionStorage.getItem('cquccp_last_tab') || ''; } catch(e) {}
    if (lastTab === 'sponsor') lastTab = 'practice';
    showTab(lastTab || 'practice');
  });
}

// ========== Practice Mode ==========

// Helper: push a fresh history entry for a question
function pushHistoryEntry(q) {
  PracticeHistory.push({
    qid: q.id,
    question: q.question,
    options: q.options,
    answer: q.answer,
    userAnswer: [],
    isCorrect: false,
    type: q.type,
    submitted: false
  });
}

// Helper: get topic-filtered question pool
function getTopicPool() {
  var topicName = Storage.getTopicName();
  if (!topicName) return [];
  if (topicName === '综合老题库') return _untaggedQs;
  return questions.filter(function(q) { return q.tags && q.tags[0] === topicName; });
}

function renderPractice() {
  const app = document.getElementById('app');
  const stats = Storage.getStats();
  const mode = Storage.getMode();
  const topicName = Storage.getTopicName();
  const isTopic = (mode === 'topic');

  var topicSelectHtml = '';
  if (isTopic) {
    topicSelectHtml = '<div class="mode-bar"><span class="mode-label">精选专题：</span>' +
      buildTopicDropdownHTML('practice', topicName, false, false) +
      '</div>';
  }

  app.innerHTML = `
    <div class="stats-bar">已练习: ${stats.totalAttempted} 题 | 错题: ${stats.totalWrong} | 收藏: ${stats.totalFav}</div>
    <div class="mode-bar">
      <span class="mode-label">模式：</span>
      <button class="mode-btn ${isTopic ? 'active' : ''}" id="btn-mode-topic">精选专题</button>
      <button class="mode-btn ${mode === 'random' ? 'active' : ''}" id="btn-mode-random">随机</button>
      <button class="mode-btn ${mode === 'sequential' ? 'active' : ''}" id="btn-mode-sequential">顺序</button>
      <button class="mode-btn ${mode === 'wrong' ? 'active' : ''}" id="btn-mode-wrong">错题</button>
      <button class="mode-btn ${mode === 'fav' ? 'active' : ''}" id="btn-mode-fav">收藏</button>
    </div>
    ${topicSelectHtml}
    <div id="practice-area"></div>
    <div id="ai-panel-container"></div>
  `;

  // Unified mode switch helper
  function switchPracticeMode(mode) {
    AIPanel.close();
    if (Storage.getMode() === mode) return;
    Storage.setMode(mode);
    if (mode !== 'topic') Storage.setTopicName('');
    PracticeHistory.clear();  // 切换模式时清空历史，防止旧模式题目泄漏
    currentQuestion = null;
    userAnswers = [];
    answerLocked = false;
    renderPractice();
  }
  document.getElementById('btn-mode-topic').addEventListener('click', function() { switchPracticeMode('topic'); });
  document.getElementById('btn-mode-random').addEventListener('click', function() { switchPracticeMode('random'); });
  document.getElementById('btn-mode-sequential').addEventListener('click', function() { switchPracticeMode('sequential'); });
  document.getElementById('btn-mode-wrong').addEventListener('click', function() { switchPracticeMode('wrong'); });
  document.getElementById('btn-mode-fav').addEventListener('click', function() { switchPracticeMode('fav'); });

  // Topic dropdown — use shared helper
  if (isTopic) {
    bindTopicDropdown('practice', function(val) {
      if (!val) return;
      Storage.setTopicName(val);
      Storage.setTopicIdx(0);
      PracticeHistory.clear();
      currentQuestion = null;
      userAnswers = [];
      answerLocked = false;
      renderPractice();
    });
  }

  // Restore current question or pick a new one
  if (currentQuestion) {
    renderQuestion(currentQuestion, answerLocked);
  } else if (mode === 'wrong' || mode === 'fav') {
    var pool = getFilteredQuestions();
    if (!pool.length) {
      var msg = mode === 'wrong' ? '暂无错题，去练习模式答错几道再来吧' : '暂无收藏，去题库中收藏几道题再来吧';
      document.getElementById('practice-area').innerHTML = '<div class="empty-state">' + msg + '</div>';
    } else {
      nextQuestion();
    }
  } else if (mode === 'topic') {
    if (!topicName) {
      document.getElementById('practice-area').innerHTML = '<div class="empty-state">请先选择一个专题</div>';
    } else {
      var topicPool = getTopicPool();
      if (!topicPool.length) {
        document.getElementById('practice-area').innerHTML = '<div class="empty-state">该专题暂无题目</div>';
      } else {
        var idx = Storage.getTopicIdx();
        if (idx >= topicPool.length) { idx = 0; /* 不持久化 */ }
        currentQuestion = topicPool[idx];
        userAnswers = [];
        answerLocked = false;
        pushHistoryEntry(currentQuestion);
        renderQuestion(currentQuestion);
      }
    }
  } else if (Storage.getMode() === 'sequential') {
    const q = questions[Storage.getSequentialIdx()];
    if (q) {
      currentQuestion = q;
      userAnswers = [];
      answerLocked = false;
      pushHistoryEntry(q);
      renderQuestion(q);
    } else {
      document.getElementById('practice-area').innerHTML = '<div class="empty-state">暂无题目</div>';
    }
  } else {
    nextQuestion();
  }
}

function getFilteredQuestions() {
  var mode = Storage.getMode();
  if (mode === 'wrong') {
    return Storage.getWrongIds().map(function(id) { return getQ(id); }).filter(Boolean);
  }
  if (mode === 'fav') {
    return Storage.getFavIds().map(function(id) { return getQ(id); }).filter(Boolean);
  }
  if (mode === 'topic') {
    return getTopicPool();
  }
  return questions;
}

function pickNextQuestion() {
  if (!questions.length) return null;
  var mode = Storage.getMode();
  // Sequential mode: pick by index from full question bank
  if (mode === 'sequential') {
    return questions[Storage.getSequentialIdx()];
  }
  // Topic mode: pick by index from filtered topic pool
  if (mode === 'topic') {
    var topicPool = getTopicPool();
    if (!topicPool.length) return null;
    var idx = Storage.getTopicIdx();
    if (idx >= topicPool.length) { idx = 0; }
    return topicPool[idx];
  }
  // Wrong / Fav mode: pick randomly from filtered pool
  if (mode === 'wrong' || mode === 'fav') {
    var pool = getFilteredQuestions();
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }
  // Random mode: 60% 从12个专题池抽，40% 从综合老题库(基础题)抽
  if (Math.random() < 0.6 && _topicQs.length) {
    return _topicQs[Math.floor(Math.random() * _topicQs.length)];
  }
  if (_untaggedQs.length) return _untaggedQs[Math.floor(Math.random() * _untaggedQs.length)];
  return questions[Math.floor(Math.random() * questions.length)];
}

function nextQuestion() {
  AIPanel.close();
  // Sequential mode: advance to next index before picking
  if (Storage.getMode() === 'sequential') {
    Storage.setSequentialIdx((Storage.getSequentialIdx() + 1) % questions.length);
  }
  // Topic mode: advance within the filtered topic pool
  if (Storage.getMode() === 'topic') {
    var topicPool = getTopicPool();
    if (topicPool.length) {
      Storage.setTopicIdx((Storage.getTopicIdx() + 1) % topicPool.length);
    }
  }
  const q = pickNextQuestion();
  if (!q) {
    var mode = Storage.getMode();
    var msg = '暂无题目';
    if (mode === 'wrong') msg = '错题已全部清除！';
    else if (mode === 'fav') msg = '暂无收藏题目';
    else if (mode === 'topic') msg = '该专题暂无题目';
    document.getElementById('practice-area').innerHTML = '<div class="empty-state">' + msg + '</div>';
    return;
  }
  currentQuestion = q;
  userAnswers = [];
  answerLocked = false;
  pushHistoryEntry(q);
  renderQuestion(q);
}

function jumpToQuestion(mode, targetIdx) {
  AIPanel.close();
  var q;
  if (mode === 'topic') {
    var pool = getTopicPool();
    if (targetIdx < 0 || targetIdx >= pool.length) return;
    Storage.setTopicIdx(targetIdx);
    q = pool[targetIdx];
  } else if (mode === 'sequential') {
    if (targetIdx < 0 || targetIdx >= questions.length) return;
    Storage.setSequentialIdx(targetIdx);
    q = questions[targetIdx];
  }
  if (!q) return;
  currentQuestion = q;
  userAnswers = [];
  answerLocked = false;
  pushHistoryEntry(q);
  renderQuestion(q);
}

function prevQuestion() {
  AIPanel.close();
  // Sequential mode: go back by index, restore state from history
  if (Storage.getMode() === 'sequential' && currentQuestion) {
    const curIdx = questions.indexOf(currentQuestion);
    if (curIdx <= 0) return;
    Storage.setSequentialIdx(curIdx - 1);
    // 先验证历史记录有效性再移动光标
    var prevEntry = PracticeHistory.peekPrev();
    var entry = (prevEntry && prevEntry.qid && getQ(prevEntry.qid)) ? PracticeHistory.back() : null;
    if (entry && entry.qid) {
      const q = getQ(entry.qid);
      if (q) {
        currentQuestion = q;
        userAnswers = entry.userAnswer || [];
        answerLocked = entry.submitted || false;
        renderQuestion(q, entry.submitted || false);
        return;
      }
    }
    // Fallback: fresh state
    const prevQ = questions[curIdx - 1];
    currentQuestion = prevQ;
    userAnswers = [];
    answerLocked = false;
    pushHistoryEntry(prevQ);
    renderQuestion(prevQ);
    return;
  }

  // Topic mode: go back by index within topic pool, restore state from history
  if (Storage.getMode() === 'topic' && currentQuestion) {
    var topicPool = getTopicPool();
    var curIdx = topicPool.indexOf(currentQuestion);
    if (curIdx <= 0) return;
    Storage.setTopicIdx(curIdx - 1);
    // 先验证历史记录有效性再移动光标
    var prevEntry = PracticeHistory.peekPrev();
    var entry = (prevEntry && prevEntry.qid && getQ(prevEntry.qid)) ? PracticeHistory.back() : null;
    if (entry && entry.qid) {
      const q = getQ(entry.qid);
      if (q) {
        currentQuestion = q;
        userAnswers = entry.userAnswer || [];
        answerLocked = entry.submitted || false;
        renderQuestion(q, entry.submitted || false);
        return;
      }
    }
    // Fallback: fresh state
    var prevQ = topicPool[curIdx - 1];
    currentQuestion = prevQ;
    userAnswers = [];
    answerLocked = false;
    pushHistoryEntry(prevQ);
    renderQuestion(prevQ);
    return;
  }

  // 先验证前一条历史记录的 qid 是否仍有效，再移动光标（避免损坏历史栈）
  var prevEntry = PracticeHistory.peekPrev();
  if (prevEntry && prevEntry.qid && getQ(prevEntry.qid)) {
    var entry = PracticeHistory.back();
    currentQuestion = getQ(entry.qid);
    userAnswers = entry.userAnswer || [];
    answerLocked = entry.submitted || false;
    renderQuestion(currentQuestion, entry.submitted || false);
    return;
  }
  // No valid history — just get a new question
  nextQuestion();
}

function renderQuestion(q, showResult = false) {
  const area = document.getElementById('practice-area');
  const isFav = Storage.isFavorite(q.id);
  const typeLabel = q.type === 'single' ? '单选题' : '多选题';
  var hasPrev;
  var topicPoolCache = null;
  if (Storage.getMode() === 'sequential') {
    hasPrev = questions.indexOf(q) > 0;
  } else if (Storage.getMode() === 'topic') {
    topicPoolCache = getTopicPool();
    hasPrev = topicPoolCache.indexOf(q) > 0;
  } else {
    hasPrev = PracticeHistory.hasPrev();
  }

  let optionsHtml = q.options.map(opt => {
    let cls = 'option';
    if (userAnswers.includes(opt.key)) cls += ' selected';
    if (answerLocked) {
      if (q.answer.includes(opt.key)) cls += ' correct';
      if (userAnswers.includes(opt.key) && !q.answer.includes(opt.key)) cls += ' wrong';
    }
    const disabled = answerLocked ? 'disabled' : '';
    return `<button class="${cls}" data-key="${opt.key}" ${disabled}>${opt.key}. ${esc(opt.text)}</button>`;
  }).join('');

  let feedbackHtml = '';
  if (answerLocked) {
    const sortedUser = [...userAnswers].sort();
    const sortedAns = [...q.answer].sort();
    const isCorrect = arraysEqual(sortedUser, sortedAns);
    const cls = isCorrect ? 'correct' : 'wrong';
    const msg = isCorrect ? '✓ 正确' : '✗ 错误';
    feedbackHtml = `
      <div class="feedback ${cls}">${msg}</div>
      <div class="answer-reveal">正确答案：<span>${sortedAns.join('、')}</span> | 你的选择：<span>${sortedUser.join('、') || '未作答'}</span></div>
    `;
  }

  const attempted = hasAttempted(q.id);
  const doneBadge = attempted ? '<span class="done-badge" title="已做过此题">✓ 已答</span>' : '';
  const mode = Storage.getMode();
  var progressHtml = esc(q.id);
  if (mode === 'sequential') {
    var seqIdx = questions.indexOf(q);
    var totalQ = _totalQuestions || questions.length;
    progressHtml = '顺序 · <span class="jump-info" data-mode="sequential" data-current="' + (seqIdx + 1) + '" data-total="' + totalQ + '">第 ' + (seqIdx + 1) + ' / ' + totalQ + ' 题 <span class="jump-link">跳转</span></span>';
  } else if (mode === 'wrong') {
    var wrongCount = Storage.getWrongIds().length;
    progressHtml = '错题模式 · 剩余 ' + wrongCount + ' 题';
  } else if (mode === 'fav') {
    var favCount = Storage.getFavIds().length;
    progressHtml = '收藏模式 · 共 ' + favCount + ' 题';
  } else if (mode === 'topic') {
    var topicIdx = topicPoolCache.indexOf(q);
    progressHtml = '专题 · <span class="jump-info" data-mode="topic" data-current="' + (topicIdx + 1) + '" data-total="' + topicPoolCache.length + '">第 ' + (topicIdx + 1) + ' / ' + topicPoolCache.length + ' 题 <span class="jump-link">跳转</span></span>';
  }

  area.innerHTML = `
    <div class="question-card">
      <div class="q-header">
        <span class="q-type ${q.type}">${typeLabel}</span>
        ${doneBadge}
        <span class="progress-info">${progressHtml}</span>
      </div>
      <div class="q-text">${esc(q.question)}</div>
      <div class="options-list">${optionsHtml}</div>
      <div class="action-bar">
        <button class="btn primary" id="btn-submit" ${answerLocked ? 'disabled' : ''}>确定</button>
        <button class="btn" id="btn-prev" ${hasPrev ? '' : 'disabled'}>上一题</button>
        <button class="btn" id="btn-next">下一题</button>
        <button class="btn btn-sm" id="btn-fav">${isFav ? '★ 取消收藏' : '☆ 收藏'}</button>
        ${mode === 'wrong' ? '<button class="btn btn-sm" id="btn-remove-wrong">移出错题集</button>' : ''}
        <button class="btn btn-sm" id="btn-ai-parse">展开解析</button>
      </div>
      ${feedbackHtml}
      ${q.explanation ? `<div class="answer-reveal">知识点：${esc(q.explanation)}</div>` : ''}
    </div>
  `;

  // Event handlers
  var jumpTrigger = document.querySelector('.jump-link');
  if (jumpTrigger) {
    jumpTrigger.addEventListener('click', function() {
      var info = this.parentElement;
      var jMode = info.dataset.mode;
      var cur = parseInt(info.dataset.current, 10);
      var total = parseInt(info.dataset.total, 10);
      info.innerHTML = '第 <input type="number" class="jump-input" id="jump-input" min="1" max="' + total + '" value="' + cur + '" inputmode="numeric" pattern="[0-9]*"> / ' + total + ' 题 <button class="jump-go" id="jump-go">前往</button>';
      var input = document.getElementById('jump-input');
      input.focus();
      input.select();
      function doJump() {
        var val = parseInt(input.value, 10);
        if (isNaN(val) || val < 1 || val > total) {
          input.classList.add('jump-error');
          setTimeout(function() { input.classList.remove('jump-error'); }, 350);
          input.focus();
          return;
        }
        jumpToQuestion(jMode, val - 1);
      }
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { doJump(); }
        if (e.key === 'Escape') { renderQuestion(currentQuestion, answerLocked); }
      });
      document.getElementById('jump-go').addEventListener('click', doJump);
    });
  }

  document.querySelectorAll('.option').forEach(btn => {
    if (answerLocked) return;
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      if (q.type === 'single') {
        userAnswers = [key];
        document.querySelectorAll('.option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      } else {
        if (userAnswers.includes(key)) {
          userAnswers = userAnswers.filter(k => k !== key);
          btn.classList.remove('selected');
        } else {
          userAnswers.push(key);
          btn.classList.add('selected');
        }
      }
    });
  });

  document.getElementById('btn-submit').addEventListener('click', () => {
    if (answerLocked) return;
    if (userAnswers.length === 0) {
      alert('请选择答案');
      return;
    }
    answerLocked = true;
    const sortedUser = [...userAnswers].sort();
    const sortedAns = [...q.answer].sort();
    const isCorrect = arraysEqual(sortedUser, sortedAns);
    Storage.recordAttempt(q.id, isCorrect);
    // Update the current history entry with answer info
    PracticeHistory.updateCurrent({
      userAnswer: sortedUser,
      isCorrect: isCorrect,
      submitted: true
    });
    userAnswers = sortedUser;
    updateStatsBar();
    AIPanel.close();
    renderQuestion(q, true);
  });

  document.getElementById('btn-next').addEventListener('click', () => nextQuestion());
  document.getElementById('btn-prev').addEventListener('click', () => prevQuestion());
  document.getElementById('btn-fav').addEventListener('click', () => {
    const nowFav = Storage.toggleFavorite(q.id);
    document.getElementById('btn-fav').textContent = nowFav ? '★ 取消收藏' : '☆ 收藏';
  });
  var removeWrongBtn = document.getElementById('btn-remove-wrong');
  if (removeWrongBtn) {
    removeWrongBtn.addEventListener('click', () => {
      Storage.removeWrong(q.id);
      updateStatsBar();
      nextQuestion();
    });
  }
  // AI 解析按钮
  var aiBtn = document.getElementById('btn-ai-parse');
  if (aiBtn) {
    if (typeof AI_ENABLED === 'undefined' || !AI_ENABLED) {
      aiBtn.textContent = '已关闭';
      aiBtn.disabled = true;
    } else {
      aiBtn.addEventListener('click', function() {
        if (!answerLocked) { alert('请先作答本题喔'); return; }
        if (AIPanel.isOpen()) { AIPanel.close(); return; }
        var cached = AICache.get(q.id);
        if (cached) { AIPanel.showCached(cached); aiBtn.textContent = '收起解析'; }
        else { aiBtn.textContent = '收起解析'; AIPanel.open(q); }
      });
      // 同步按钮文字：面板已打开则显示"收起解析"
      if (AIPanel.isOpen()) aiBtn.textContent = '收起解析';
    }
  }
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

// Update stats bar text (for practice view) without full re-render
function updateStatsBar() {
  var bar = document.querySelector('.stats-bar');
  if (!bar) return;
  var stats = Storage.getStats();
  bar.textContent = '已练习: ' + stats.totalAttempted + ' 题 | 错题: ' + stats.totalWrong + ' | 收藏: ' + stats.totalFav;
}

// Check if a question has been attempted before
function hasAttempted(qid) {
  return Storage.getQ(qid).attempts > 0;
}

// ========== All Questions ==========
function renderAllQuestions() {
  const app = document.getElementById('app');
  let typeFilter = 'all';     // 'all' | 'single' | 'multiple'
  let statusFilter = 'all';   // 'all' | 'undone' | 'done' | 'wrong' | 'fav'
  let topicFilter = 'all';    // 'all' | topic name | 'other'

  function applyFilters() {
    const kw = document.getElementById('search-all').value.toLowerCase();
    let filtered = questions;

    // 搜索
    if (kw) {
      filtered = filtered.filter(q => q.question.toLowerCase().includes(kw) || q.options.some(o => o.text.toLowerCase().includes(kw)));
    }
    // 题型筛选
    if (typeFilter !== 'all') {
      filtered = filtered.filter(q => q.type === typeFilter);
    }
    // 专题筛选
    if (topicFilter !== 'all') {
      if (topicFilter === '综合老题库') {
        filtered = filtered.filter(q => !q.tags || !q.tags[0]);
      } else {
        filtered = filtered.filter(q => q.tags && q.tags[0] === topicFilter);
      }
    }
    // 状态筛选
    if (statusFilter === 'undone') {
      filtered = filtered.filter(q => !hasAttempted(q.id));
    } else if (statusFilter === 'done') {
      filtered = filtered.filter(q => hasAttempted(q.id));
    } else if (statusFilter === 'wrong') {
      filtered = filtered.filter(q => Storage.getQ(q.id).isWrong);
    } else if (statusFilter === 'fav') {
      filtered = filtered.filter(q => Storage.isFavorite(q.id));
    }

    renderListItems(filtered, 'list-all');
    var statsEl = document.getElementById('stats-all');
    if (statsEl) {
      var total = _totalQuestions || questions.length;
      statsEl.textContent = '共 ' + total + ' 题 | 已加载 ' + questions.length + ' 题 | 筛选 ' + filtered.length + ' 题';
    }
  }

  var topicDropdownHtml = buildTopicDropdownHTML('all', 'all', true, false);

  app.innerHTML = `
    <input class="search-box" id="search-all" placeholder="搜索题目..." inputmode="search" autocomplete="off">
    <div class="filter-bar">
      <div class="filter-row">
        <span class="filter-label">精选专题：</span>
        ${topicDropdownHtml}
      </div>
      <div class="filter-row">
        <span class="filter-label">题型：</span>
        <button class="filter-chip active" data-type="all">全部</button>
        <button class="filter-chip" data-type="single">单选</button>
        <button class="filter-chip" data-type="multiple">多选</button>
      </div>
      <div class="filter-row">
        <span class="filter-label">状态：</span>
        <button class="filter-chip active" data-status="all">全部</button>
        <button class="filter-chip" data-status="undone">未做</button>
        <button class="filter-chip" data-status="done">已做</button>
        <button class="filter-chip" data-status="wrong">错题</button>
        <button class="filter-chip" data-status="fav">收藏</button>
      </div>
    </div>
    <div class="stats-bar" id="stats-all">共 ${_totalQuestions || questions.length} 题 | 已加载 ${questions.length} 题</div>
    <div id="list-all"></div>
  `;

  renderListItems(questions, 'list-all');

  var _searchTimer = null;
  document.getElementById('search-all').addEventListener('input', function() {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(applyFilters, 200);
  });

  // Topic dropdown for all questions
  bindTopicDropdown('all', function(val) { topicFilter = val; applyFilters(); });

  document.querySelectorAll('[data-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-type]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      typeFilter = btn.dataset.type;
      applyFilters();
    });
  });

  document.querySelectorAll('[data-status]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-status]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      statusFilter = btn.dataset.status;
      applyFilters();
    });
  });
}

function renderListItems(qs, containerId, showRemoveWrong = false, showRemoveFav = false) {
  const container = document.getElementById(containerId);
  if (!qs.length) {
    container.innerHTML = '<div class="empty-state">暂无题目</div>';
    return;
  }
  // 分批渲染，避免主线程阻塞导致移动端卡顿
  container.innerHTML = '';
  renderListItems._seq = (renderListItems._seq || 0) + 1;
  var batchGen = renderListItems._seq;
  container._batchGen = batchGen;
  const CHUNK = 60;
  let idx = 0;
  function appendBatch() {
    if (container._batchGen !== batchGen) return; // 被新调用取消
    const end = Math.min(idx + CHUNK, qs.length);
    const frag = document.createDocumentFragment();
    for (let i = idx; i < end; i++) {
      const q = qs[i];
      const isFav = Storage.isFavorite(q.id);
      const attempted = hasAttempted(q.id);
      const typeLabel = q.type === 'single' ? '单选' : '多选';
      const doneBadge = attempted ? '<span class="done-badge" title="已做过此题">✓ 已答</span>' : '';
      const optsHtml = q.options.map(o => {
        return '<span class="opt-line" data-qid="' + q.id + '" data-key="' + o.key + '">' + o.key + '. ' + esc(o.text) + '</span>';
      }).join(' ');

      let btns = '<button class="btn-sm toggle-ans" data-qid="' + q.id + '">显示答案</button>';
      if (showRemoveFav) {
        btns += '<button class="btn-sm remove-fav" data-qid="' + q.id + '">取消收藏</button>';
      } else {
        btns += '<button class="btn-sm toggle-fav" data-qid="' + q.id + '">' + (isFav ? '取消收藏' : '收藏') + '</button>';
      }
      if (showRemoveWrong) {
        btns += '<button class="btn-sm remove-wrong" data-qid="' + q.id + '">移出错题集</button>';
      }

      const div = document.createElement('div');
      div.className = 'list-item';
      div.id = 'item-' + q.id;
      div.innerHTML =
        '<span class="q-type ' + q.type + '">' + typeLabel + '</span>' +
        doneBadge +
        '<span class="q-id-label">' + q.id + '</span>' +
        '<div class="q-text">' + esc(q.question) + '</div>' +
        '<div class="list-options">' + optsHtml + '</div>' +
        '<div class="list-actions">' + btns + '</div>' +
        '<div class="answer-reveal" id="ans-' + q.id + '" style="display:none;">答案：<span>' + q.answer.join('、') + '</span></div>';
      frag.appendChild(div);
    }
    container.appendChild(frag);
    idx = end;
    if (idx < qs.length) {
      requestAnimationFrame(appendBatch);
    }
  }
  appendBatch();

  // 事件委托：绑定在容器上，无需每次重新绑定
  container.onclick = function(e) {
    var btn = e.target.closest('.toggle-ans, .toggle-fav, .remove-fav, .remove-wrong');
    if (!btn) return;
    var qid = btn.dataset.qid;
    if (btn.classList.contains('toggle-ans')) {
      var ansDiv = document.getElementById('ans-' + qid);
      var q = getQ(qid);
      var showing = ansDiv.style.display !== 'none';
      if (showing) {
        ansDiv.style.display = 'none';
        btn.textContent = '显示答案';
        container.querySelectorAll('.opt-line[data-qid="' + qid + '"]').forEach(function(el) {
          el.classList.remove('answer-highlight');
        });
      } else {
        ansDiv.style.display = 'block';
        btn.textContent = '隐藏答案';
        if (q) {
          container.querySelectorAll('.opt-line[data-qid="' + qid + '"]').forEach(function(el) {
            if (q.answer.includes(el.dataset.key)) {
              el.classList.add('answer-highlight');
            }
          });
        }
      }
    } else if (btn.classList.contains('toggle-fav')) {
      var isNowFav = Storage.toggleFavorite(qid);
      btn.textContent = isNowFav ? '取消收藏' : '收藏';
    } else if (btn.classList.contains('remove-fav')) {
      Storage.toggleFavorite(qid);
      showTab('fav');
    } else if (btn.classList.contains('remove-wrong')) {
      Storage.removeWrong(qid);
      showTab('wrong');
    }
  };
}

// ========== Mock Exam ==========
let examState = null;  // { questions, answers, startTime, timerInterval, submitted, currentIdx }
const EXAM_HISTORY_KEY = 'party_exam_history_v2';
const EXAM_DRAFT_KEY = 'party_exam_draft';

function saveExamDraft() {
  if (!examState || examState.submitted) return;
  try {
    var qids = examState.questions.map(function(q) { return q.id; });
    localStorage.setItem(EXAM_DRAFT_KEY, JSON.stringify({
      qids: qids,
      answers: examState.answers,
      marked: examState.marked,
      currentIdx: examState.currentIdx,
      elapsed: Math.floor((Date.now() - examState.startTime) / 1000)
    }));
  } catch(e) {}
}
var _examSaveTimer = null;
var _examAutoAdvanceTimer = null;
function saveExamDraftDebounced() {
  if (_examSaveTimer) clearTimeout(_examSaveTimer);
  _examSaveTimer = setTimeout(function() {
    _examSaveTimer = null;
    saveExamDraft();
  }, 2000);
}
function loadExamDraft() {
  try {
    var raw = localStorage.getItem(EXAM_DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}
function clearExamDraft() {
  localStorage.removeItem(EXAM_DRAFT_KEY);
}
const ExamHistory = {
  MAX: 20,
  _cache: null,
  load() {
    if (this._cache) return this._cache;
    try {
      this._cache = JSON.parse(localStorage.getItem(EXAM_HISTORY_KEY)) || [];
    } catch (e) { this._cache = []; }
    return this._cache;
  },
  save(records) {
    this._cache = records;
    try { localStorage.setItem(EXAM_HISTORY_KEY, JSON.stringify(records)); } catch (e) {}
  },
  add(record) {
    var records = this.load();
    records.unshift(record);
    if (records.length > this.MAX) records = records.slice(0, this.MAX);
    this.save(records);
  },
  get(idx) { return this.load()[idx] || null; }
};

function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

// Pick n random items without full shuffle — partial Fisher-Yates
function pickRandom(arr, n) {
  if (n >= arr.length) return shuffle(arr);
  var len = arr.length;
  var result = new Array(n);
  var swapped = {};
  for (var i = 0; i < n; i++) {
    var j = i + Math.floor(Math.random() * (len - i));
    result[i] = swapped[j] !== undefined ? swapped[j] : arr[j];
    swapped[j] = swapped[i] !== undefined ? swapped[i] : arr[i];
  }
  return result;
}

function formatTime(totalSeconds) {
  var m = Math.floor(totalSeconds / 60);
  var s = totalSeconds % 60;
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

function renderExam() {
  if (!examState) {
    renderExamStart();
  } else if (examState.submitted) {
    renderExamResult();
  } else {
    renderExamUI();
  }
}

function renderExamStart() {
  var app = document.getElementById('app');
  var histCount = ExamHistory.load().length;
  var draft = loadExamDraft();
  var histBtnHtml = histCount > 0
    ? '<button class="btn btn-exam-history" id="btn-exam-history">历史记录（' + histCount + '）</button>'
    : '';
  var isBankLoading = _totalQuestions > questions.length;
  var startDisabled = isBankLoading ? ' disabled' : '';
  var startLabel = isBankLoading ? '题库加载中' : '开始考试';

  var resumeHtml = '';
  if (draft && draft.qids && draft.qids.length) {
    var answered = Object.values(draft.answers || {}).filter(function(a) { return a.length > 0; }).length;
    var elapsed = formatTime(draft.elapsed || 0);
    resumeHtml = '<button class="btn primary btn-start-exam" id="btn-resume-exam" style="margin-bottom:12px;">继续上次考试（已答 ' + answered + '/' + draft.qids.length + ' 题，用时 ' + elapsed + '） →</button>';
  }

  app.innerHTML = `
    <div class="exam-start">
      <h2>模拟考试</h2>
      <p class="exam-start-subtitle">随机抽取 50 题 · 单选多选混合 · 不限时</p>
      <div class="exam-info-chips">
        <span class="exam-info-chip">50 题</span>
        <span class="exam-info-chip">单选+多选</span>
        <span class="exam-info-chip">⏱ 不限时</span>
      </div>
      ${resumeHtml}
      <button class="btn primary btn-start-exam" id="btn-start-exam"${startDisabled}>
        <span>${startLabel}</span><span class="btn-arrow"> →</span>
      </button>
      ${histBtnHtml}
    </div>
  `;
  document.getElementById('btn-start-exam').addEventListener('click', startExam);
  var resumeBtn = document.getElementById('btn-resume-exam');
  if (resumeBtn) resumeBtn.addEventListener('click', resumeExam);
  var histBtn = document.getElementById('btn-exam-history');
  if (histBtn) histBtn.addEventListener('click', function() { renderExamHistoryList(); });
}

function resumeExam() {
  if (_totalQuestions > questions.length) {
    loadFullQuestionBank(true).then(resumeExam).catch(function(e) { alert('题库加载失败，无法恢复考试，请检查网络后重试'); console.warn('resumeExam bank load failed:', e); });
    return;
  }
  var draft = loadExamDraft();
  if (!draft || !draft.qids) return;
  var qs = draft.qids.map(function(id) { return getQ(id); }).filter(Boolean);
  if (!qs.length) { clearExamDraft(); renderExamStart(); return; }
  if (examState && examState.timerInterval) clearInterval(examState.timerInterval);
  if (_examAutoAdvanceTimer) { clearTimeout(_examAutoAdvanceTimer); _examAutoAdvanceTimer = null; }
  examState = {
    questions: qs,
    answers: draft.answers || {},
    marked: draft.marked || {},
    startTime: Date.now() - ((draft.elapsed || 0) * 1000),
    timerInterval: null,
    submitted: false,
    currentIdx: draft.currentIdx || 0
  };
  examState.timerInterval = setInterval(function() {
    var elapsed = Math.floor((Date.now() - examState.startTime) / 1000);
    var timerEl = document.getElementById('exam-timer');
    if (timerEl) timerEl.textContent = formatTime(elapsed);
  }, 1000);
  renderExamUI();
}

function startExam() {
  if (_totalQuestions > questions.length) {
    loadFullQuestionBank(true).then(startExam).catch(function(e) { alert('题库加载失败，请检查网络后重试'); console.warn('startExam bank load failed:', e); });
    return;
  }
  if (questions.length < 50) {
    alert('题库题目不足 50 道，无法开始模拟考试');
    return;
  }
  // 按专题分区：作者精选10题 + 1-8号25题 + 综合精选5题 + 9号2题 + 10号3题 + 基础5题(未做过) = 50
  var byTag = {};
  for (var qi = 0; qi < questions.length; qi++) {
    var tag = (questions[qi].tags && questions[qi].tags[0]) || '';
    if (!byTag[tag]) byTag[tag] = [];
    byTag[tag].push(questions[qi]);
  }
  var tAuthor = byTag[TOPICS[0]] || [];                   // 作者精选题库
  var tComprehensive = byTag[TOPICS[10]] || [];           // 综合易错
  var t1to8 = [];
  for (var ti = 1; ti <= 8; ti++) {
    var pool = byTag[TOPICS[ti]];
    if (pool) t1to8 = t1to8.concat(pool);
  }
  var tSuppl = byTag[TOPICS[9]] || [];                    // 综合补充
  var tEightRules = byTag[TOPICS[12]] || [];              // 中央八项规定精神
  var untagged = byTag[''] || [];
  var untaggedNew = untagged.filter(function(q) { return !hasAttempted(q.id); });
  if (untaggedNew.length < 5) untaggedNew = untagged.slice();  // 未做题不足则用全部基础题

  if (tAuthor.length < 10 || tComprehensive.length < 5 || t1to8.length < 25 || tSuppl.length < 2 || tEightRules.length < 3 || untaggedNew.length < 5) {
    alert('题库不足，无法开始模拟考试（需：' + TOPICS[0] + '≥10, ' + TOPICS[1] + '~' + TOPICS[8] + '≥25, ' + TOPICS[10] + '≥5, ' + TOPICS[9] + '≥2, ' + TOPICS[12] + '≥3, 基础题≥5）');
    return;
  }
  var picked = pickRandom(tAuthor, 10).concat(pickRandom(t1to8, 25)).concat(pickRandom(tComprehensive, 5)).concat(pickRandom(tSuppl, 2)).concat(pickRandom(tEightRules, 3)).concat(pickRandom(untaggedNew, 5));
  picked = shuffle(picked);
  var answers = {};
  for (var i = 0; i < picked.length; i++) { answers[i] = []; }
  var startTime = Date.now();

  clearExamDraft();
  if (examState && examState.timerInterval) clearInterval(examState.timerInterval);
  if (_examAutoAdvanceTimer) { clearTimeout(_examAutoAdvanceTimer); _examAutoAdvanceTimer = null; }
  examState = {
    questions: picked,
    answers: answers,
    marked: {},
    startTime: startTime,
    timerInterval: null,
    submitted: false,
    currentIdx: 0
  };

  // Start timer
  examState.timerInterval = setInterval(function() {
    var elapsed = Math.floor((Date.now() - examState.startTime) / 1000);
    var timerEl = document.getElementById('exam-timer');
    if (timerEl) {
      timerEl.textContent = formatTime(elapsed);
    }
  }, 1000);

  renderExamUI();
}

function renderExamUI() {
  var app = document.getElementById('app');
  var elapsed = Math.floor((Date.now() - examState.startTime) / 1000);
  var total = examState.questions.length;
  var answeredCount = Object.values(examState.answers).filter(function(a) { return a.length > 0; }).length;
  var pct = Math.round(answeredCount / total * 100);

  var navHtml = '';
  for (var i = 0; i < total; i++) {
    var cls = 'exam-nav-item';
    if (i === examState.currentIdx) cls += ' current';
    if (examState.answers[i] && examState.answers[i].length > 0) cls += ' answered';
    if (examState.marked[i]) cls += ' marked';
    navHtml += '<button class="' + cls + '" data-idx="' + i + '">' + (i + 1) + '</button>';
  }

  app.innerHTML = `
    <div class="exam-header">
      <div class="exam-header-left">
        <div class="exam-progress-row">
          <span class="exam-progress-label">答题进度</span>
          <span class="exam-progress-count">${answeredCount}<span class="exam-progress-total">/${total}</span></span>
        </div>
        <div class="exam-progress-bar"><div class="exam-progress-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="exam-timer-wrap">
        <span class="exam-timer running" id="exam-timer">${formatTime(elapsed)}</span>
      </div>
      <button class="btn btn-submit-exam" id="btn-submit-exam">交卷</button>
    </div>
    <div id="exam-question-area"></div>
    <div class="exam-nav-label">题目导航</div>
    <div class="exam-nav">${navHtml}</div>
  `;

  renderExamQuestion(examState.currentIdx);

  // Question nav click handlers
  document.querySelectorAll('.exam-nav-item').forEach(function(btn) {
    btn.addEventListener('click', function() {
      navigateExamQuestion(parseInt(this.dataset.idx, 10));
    });
  });

  // Submit handler
  document.getElementById('btn-submit-exam').addEventListener('click', function() {
    var unanswered = total - answeredCount;
    if (unanswered > 0) {
      if (!confirm('还有 ' + unanswered + ' 道题未作答，确定交卷吗？')) return;
    } else {
      if (!confirm('确定交卷吗？')) return;
    }
    submitExam();
  });
}

function renderExamQuestion(idx) {
  var area = document.getElementById('exam-question-area');
  var q = examState.questions[idx];
  var total = examState.questions.length;
  var typeLabel = q.type === 'single' ? '单选题' : '多选题';
  var userAns = examState.answers[idx] || [];

  var optionsHtml = q.options.map(function(opt) {
    var cls = 'option';
    if (userAns.indexOf(opt.key) !== -1) cls += ' selected';
    return '<button class="' + cls + '" data-key="' + opt.key + '">' + opt.key + '. ' + esc(opt.text) + '</button>';
  }).join('');

  var hasPrev = idx > 0;
  var hasNext = idx < total - 1;
  var actionHtml = '';
  var isExamFav = Storage.isFavorite(q.id);
  var isMarked = examState.marked[idx];
  if (q.type === 'single') {
    actionHtml =
      '<button class="btn" id="btn-exam-prev" ' + (hasPrev ? '' : 'disabled') + '>上一题</button>' +
      '<button class="btn" id="btn-exam-next" ' + (hasNext ? '' : 'disabled') + '>下一题</button>' +
      '<button class="btn btn-sm" id="btn-exam-fav">' + (isExamFav ? '★ 取消收藏' : '☆ 收藏') + '</button>' +
      '<button class="btn btn-sm" id="btn-exam-mark">' + (isMarked ? '🏷 已标记' : '🏷 标记') + '</button>';
  } else {
    actionHtml =
      '<button class="btn" id="btn-exam-prev" ' + (hasPrev ? '' : 'disabled') + '>上一题</button>' +
      '<button class="btn primary" id="btn-exam-confirm">确定</button>' +
      '<button class="btn" id="btn-exam-next" ' + (hasNext ? '' : 'disabled') + '>下一题</button>' +
      '<button class="btn btn-sm" id="btn-exam-fav">' + (isExamFav ? '★ 取消收藏' : '☆ 收藏') + '</button>' +
      '<button class="btn btn-sm" id="btn-exam-mark">' + (isMarked ? '🏷 已标记' : '🏷 标记') + '</button>';
  }

  area.innerHTML = `
    <div class="question-card">
      <div class="q-header">
        <span class="q-type ${q.type}">${typeLabel}</span>
        <span class="progress-info">第 ${idx + 1}/${total} 题</span>
      </div>
      <div class="q-text">${esc(q.question)}</div>
      <div class="options-list">${optionsHtml}</div>
      <div class="action-bar">${actionHtml}</div>
    </div>
  `;

  function goNext() {
    var cur = examState.currentIdx;
    if (cur < total - 1) navigateExamQuestion(cur + 1);
  }
  function goPrev() {
    var cur = examState.currentIdx;
    if (cur > 0) navigateExamQuestion(cur - 1);
  }

  // Option click handlers
  area.querySelectorAll('.option').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var key = this.dataset.key;
      if (q.type === 'single') {
        examState.answers[idx] = [key];
        saveExamDraftDebounced();
        area.querySelectorAll('.option').forEach(function(b) { b.classList.remove('selected'); });
        this.classList.add('selected');
        updateExamNavIndicator(idx);
        updateExamAnsweredCount();
        // 单选点击即下一题
        if (_examAutoAdvanceTimer) { clearTimeout(_examAutoAdvanceTimer); }
        _examAutoAdvanceTimer = setTimeout(function() {
          _examAutoAdvanceTimer = null;
          if (!examState) return;
          goNext();
        }, 200);
      } else {
        var cur = examState.answers[idx] || [];
        if (cur.indexOf(key) !== -1) {
          examState.answers[idx] = cur.filter(function(k) { return k !== key; });
        } else {
          examState.answers[idx] = cur.concat([key]);
        }
        saveExamDraftDebounced();
        this.classList.toggle('selected', examState.answers[idx].indexOf(key) !== -1);
        updateExamNavIndicator(idx);
        updateExamAnsweredCount();
      }
    });
  });

  // Navigation buttons
  var prevBtn = document.getElementById('btn-exam-prev');
  var nextBtn = document.getElementById('btn-exam-next');
  if (prevBtn) prevBtn.addEventListener('click', goPrev);
  if (nextBtn) nextBtn.addEventListener('click', goNext);
  // 多选：确定即下一题
  var confirmBtn = document.getElementById('btn-exam-confirm');
  if (confirmBtn) confirmBtn.addEventListener('click', goNext);
  // 收藏按钮
  var examFavBtn = document.getElementById('btn-exam-fav');
  if (examFavBtn) {
    examFavBtn.addEventListener('click', function() {
      var nowFav = Storage.toggleFavorite(q.id);
      this.textContent = nowFav ? '★ 取消收藏' : '☆ 收藏';
    });
  }
  // 标记按钮
  var examMarkBtn = document.getElementById('btn-exam-mark');
  if (examMarkBtn) {
    examMarkBtn.addEventListener('click', function() {
      examState.marked[idx] = !examState.marked[idx];
      saveExamDraftDebounced();
      this.textContent = examState.marked[idx] ? '🏷 已标记' : '🏷 标记';
      updateExamNavIndicator(idx);
    });
  }
}

function updateExamNavIndicator(idx) {
  var btns = document.querySelectorAll('.exam-nav-item');
  btns.forEach(function(btn) {
    var i = parseInt(btn.dataset.idx, 10);
    btn.classList.remove('current', 'answered', 'marked');
    if (i === idx) btn.classList.add('current');
    if (examState.answers[i] && examState.answers[i].length > 0) btn.classList.add('answered');
    if (examState.marked[i]) btn.classList.add('marked');
  });
}

function updateExamAnsweredCount() {
  var total = examState.questions.length;
  var count = Object.values(examState.answers).filter(function(a) { return a.length > 0; }).length;
  var pct = Math.round(count / total * 100);
  var countEl = document.querySelector('.exam-progress-count');
  if (countEl) countEl.innerHTML = count + '<span class="exam-progress-total">/' + total + '</span>';
  var fillEl = document.querySelector('.exam-progress-fill');
  if (fillEl) fillEl.style.width = pct + '%';
}

function navigateExamQuestion(idx) {
  if (_examSaveTimer) { clearTimeout(_examSaveTimer); _examSaveTimer = null; saveExamDraft(); }
  examState.currentIdx = idx;
  renderExamQuestion(idx);
  updateExamNavIndicator(idx);
}

function submitExam() {
  if (!examState || examState.submitted) return;
  // Stop timer
  if (_examSaveTimer) { clearTimeout(_examSaveTimer); _examSaveTimer = null; }
  if (_examAutoAdvanceTimer) { clearTimeout(_examAutoAdvanceTimer); _examAutoAdvanceTimer = null; }
  clearInterval(examState.timerInterval);
  examState.submitted = true;
  clearExamDraft();
  var elapsed = Math.floor((Date.now() - examState.startTime) / 1000);

  // Grade all questions
  var correct = 0;
  var wrongList = [];
  var resultList = [];
  var batchRecords = [];
  for (var i = 0; i < examState.questions.length; i++) {
    var q = examState.questions[i];
    var userAns = (examState.answers[i] || []).slice().sort();
    var correctAns = q.answer.slice().sort();
    var isCorrect = userAns.join('') === correctAns.join('');
    if (isCorrect) correct++;
    else wrongList.push({ question: q, userAnswer: userAns, index: i });
    resultList.push({
      question: q,
      userAnswer: userAns,
      correctAnswer: correctAns,
      isCorrect: isCorrect,
      index: i
    });
    batchRecords.push({ qid: q.id, isCorrect: isCorrect });
  }
  Storage.batchRecordAttempt(batchRecords);

  examState.score = correct;
  examState.elapsed = elapsed;
  examState.wrongList = wrongList;
  examState.resultList = resultList;

  // Save to history
  var now = new Date();
  var dateStr = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0') + ' ' +
    String(now.getHours()).padStart(2, '0') + ':' +
    String(now.getMinutes()).padStart(2, '0');
  var total = examState.questions.length;
  ExamHistory.add({
    date: dateStr,
    score: correct,
    total: total,
    rate: Math.round(correct / total * 100),
    elapsed: elapsed,
    wrongCount: wrongList.length,
    resultList: resultList
  });

  renderExamResult();
}

function buildExamResultItem(r, idx) {
  var q = r.question;
  var typeLabel = q.type === 'single' ? '单选' : '多选';
  var statusIcon = r.isCorrect ? '✓' : '✗';
  var statusClass = r.isCorrect ? 'result-correct' : 'result-wrong';

  var optsHtml = q.options.map(function(opt) {
    var cls = 'option';
    var isCorrect = q.answer.indexOf(opt.key) !== -1;
    var isUserSelected = r.userAnswer.indexOf(opt.key) !== -1;
    if (isCorrect && isUserSelected) {
      cls += ' correct';
    } else if (isCorrect && !isUserSelected) {
      cls += ' correct';
    } else if (!isCorrect && isUserSelected) {
      cls += ' wrong';
    }
    var disabled = 'disabled';
    return '<button class="' + cls + '" ' + disabled + '>' + opt.key + '. ' + esc(opt.text) + '</button>';
  }).join('');

  var answerRow = '';
  if (!r.isCorrect) {
    answerRow = '<div class="exam-wrong-answers">' +
      '<div class="answer-row wrong-row">✗ 你的答案：' + (r.userAnswer.join('、') || '未作答') + '</div>' +
      '<div class="answer-row correct-row">✓ 正确答案：' + r.correctAnswer.join('、') + '</div>' +
      '</div>';
  }

  return '<div class="exam-result-item ' + statusClass + '">' +
    '<div class="exam-result-header">' +
      '<span class="q-num ' + statusClass + '">' + statusIcon + '</span>' +
      '<span class="exam-result-num">' + (idx + 1) + '</span>' +
      '<span class="q-type-sm ' + q.type + '">' + typeLabel + '</span>' +
    '</div>' +
    '<div class="exam-result-question">' + esc(q.question) + '</div>' +
    '<div class="exam-result-options">' + optsHtml + '</div>' +
    answerRow +
  '</div>';
}

function renderExamResult() {
  var app = document.getElementById('app');
  var total = examState.questions.length;
  var score = examState.score;
  var rate = Math.round(score / total * 100);
  var elapsed = examState.elapsed;
  var wrongList = examState.wrongList;
  var resultList = examState.resultList;

  var ringClass = 'ring-fill';
  if (rate >= 90) ringClass += ' perfect';
  else if (rate >= 60) ringClass += ' good';
  else ringClass += ' fail';

  var circumference = 326.73;
  var offset = circumference - (circumference * rate / 100);

  app.innerHTML = `
    <div class="exam-result">
      <h2>考试结果</h2>
      <div class="exam-score-visual">
        <svg class="exam-score-ring" viewBox="0 0 120 120">
          <circle class="ring-bg" cx="60" cy="60" r="52"></circle>
          <circle class="${ringClass}" cx="60" cy="60" r="52"
            stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"></circle>
        </svg>
        <div class="exam-score-inner">
          <span class="exam-score-num ${rate >= 60 ? '' : 'fail-color'}">${score}</span>
          <span class="exam-score-total">/ ${total}</span>
        </div>
      </div>
      <div class="exam-stats-row">
        <div class="exam-stat-card">
          <span class="exam-stat-value" style="color:${rate >= 90 ? 'var(--success)' : rate >= 60 ? 'var(--accent)' : 'var(--danger)'}">${rate}%</span>
          <span class="exam-stat-label">正确率</span>
        </div>
        <div class="exam-stat-card">
          <span class="exam-stat-value">${formatTime(elapsed)}</span>
          <span class="exam-stat-label">用时</span>
        </div>
        <div class="exam-stat-card">
          <span class="exam-stat-value" style="color:${wrongList.length > 0 ? 'var(--danger)' : 'var(--success)'}">${wrongList.length}</span>
          <span class="exam-stat-label">错题</span>
        </div>
      </div>
      <div class="exam-result-filter">
        <button class="filter-chip active" data-view="all">全部 ${total}</button>
        <button class="filter-chip" data-view="wrong">仅错题 ${wrongList.length}</button>
      </div>
      <div id="exam-result-list"></div>
      <div class="exam-result-actions">
        <button class="btn primary" id="btn-retry-exam">重新考试</button>
        <button class="btn" id="btn-review-exam">返回首页</button>
      </div>
    </div>
  `;

  // Build all result items HTML
  var allItemsHtml = resultList.map(function(r, i) { return buildExamResultItem(r, i); }).join('');
  var wrongItemsHtml = resultList.filter(function(r) { return !r.isCorrect; })
    .map(function(r, i) { return buildExamResultItem(r, i); }).join('');

  var listEl = document.getElementById('exam-result-list');
  listEl.innerHTML = allItemsHtml;

  // Filter toggle
  document.querySelectorAll('[data-view]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('[data-view]').forEach(function(b) { b.classList.remove('active'); });
      this.classList.add('active');
      listEl.innerHTML = this.dataset.view === 'wrong' ? wrongItemsHtml : allItemsHtml;
    });
  });

  document.getElementById('btn-retry-exam').addEventListener('click', function() {
    startExam();
  });
  document.getElementById('btn-review-exam').addEventListener('click', function() {
    examState = null;
    currentQuestion = null;
    userAnswers = [];
    answerLocked = false;
    showTab('practice');
    document.querySelectorAll('#top-nav button').forEach(function(b) { b.classList.remove('active'); });
    document.querySelector('#top-nav button[data-tab="practice"]').classList.add('active');
  });
}

// ========== Exam History ==========
function renderExamHistoryList() {
  var app = document.getElementById('app');
  var records = ExamHistory.load();
  if (!records.length) {
    app.innerHTML = '<div class="empty-state">暂无考试记录</div>';
    return;
  }
  var listHtml = records.map(function(r, i) {
    var rateColor = r.rate >= 90 ? 'var(--success)' : r.rate >= 60 ? 'var(--accent)' : 'var(--danger)';
    return '<div class="exam-history-item" data-idx="' + i + '">' +
      '<div class="exam-history-main">' +
        '<span class="exam-history-date">' + r.date + '</span>' +
        '<span class="exam-history-score" style="color:' + rateColor + '">' + r.rate + '%</span>' +
      '</div>' +
      '<div class="exam-history-meta">' +
        '<span>' + r.score + '/' + r.total + ' 题</span>' +
        '<span>' + formatTime(r.elapsed) + '</span>' +
        '<span>错题 ' + r.wrongCount + '</span>' +
      '</div>' +
    '</div>';
  }).join('');

  app.innerHTML = '<div class="exam-history-page">' +
    '<div class="exam-history-header">' +
      '<button class="btn btn-sm" id="btn-back-exam">← 返回</button>' +
      '<h3>考试历史</h3>' +
      '<span></span>' +
    '</div>' +
    listHtml +
  '</div>';

  document.getElementById('btn-back-exam').addEventListener('click', function() { renderExam(); });
  app.querySelectorAll('.exam-history-item').forEach(function(el) {
    el.addEventListener('click', function() {
      renderExamHistoryDetail(parseInt(this.dataset.idx, 10));
    });
  });
}

function renderExamHistoryDetail(idx) {
  var record = ExamHistory.get(idx);
  if (!record) { renderExamHistoryList(); return; }
  var app = document.getElementById('app');
  var rate = record.rate;
  var wrongCount = record.wrongCount;
  var total = record.total;

  var ringClass = 'ring-fill';
  if (rate >= 90) ringClass += ' perfect';
  else if (rate >= 60) ringClass += ' good';
  else ringClass += ' fail';

  var circumference = 326.73;
  var offset = circumference - (circumference * rate / 100);

  var allItemsHtml = record.resultList.map(function(r, i) { return buildExamResultItem(r, i); }).join('');
  var wrongItemsHtml = record.resultList.filter(function(r) { return !r.isCorrect; })
    .map(function(r, i) { return buildExamResultItem(r, i); }).join('');

  app.innerHTML = '<div class="exam-result">' +
    '<div class="exam-history-header" style="margin-bottom:20px;">' +
      '<button class="btn btn-sm" id="btn-back-history">← 返回</button>' +
      '<h3 style="margin:0;">' + record.date + '</h3>' +
      '<span></span>' +
    '</div>' +
    '<div class="exam-score-visual">' +
      '<svg class="exam-score-ring" viewBox="0 0 120 120">' +
        '<circle class="ring-bg" cx="60" cy="60" r="52"></circle>' +
        '<circle class="' + ringClass + '" cx="60" cy="60" r="52" stroke-dasharray="' + circumference + '" stroke-dashoffset="' + offset + '"></circle>' +
      '</svg>' +
      '<div class="exam-score-inner">' +
        '<span class="exam-score-num ' + (rate >= 60 ? '' : 'fail-color') + '">' + record.score + '</span>' +
        '<span class="exam-score-total">/ ' + total + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="exam-stats-row">' +
      '<div class="exam-stat-card"><span class="exam-stat-value" style="color:' + (rate >= 90 ? 'var(--success)' : rate >= 60 ? 'var(--accent)' : 'var(--danger)') + '">' + rate + '%</span><span class="exam-stat-label">正确率</span></div>' +
      '<div class="exam-stat-card"><span class="exam-stat-value">' + formatTime(record.elapsed) + '</span><span class="exam-stat-label">用时</span></div>' +
      '<div class="exam-stat-card"><span class="exam-stat-value" style="color:' + (wrongCount > 0 ? 'var(--danger)' : 'var(--success)') + '">' + wrongCount + '</span><span class="exam-stat-label">错题</span></div>' +
    '</div>' +
    '<div class="exam-result-filter">' +
      '<button class="filter-chip active" data-view="all">全部 ' + total + '</button>' +
      '<button class="filter-chip" data-view="wrong">仅错题 ' + wrongCount + '</button>' +
    '</div>' +
    '<div id="exam-result-list">' + allItemsHtml + '</div>' +
  '</div>';

  document.getElementById('btn-back-history').addEventListener('click', function() { renderExamHistoryList(); });
  document.querySelectorAll('[data-view]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('[data-view]').forEach(function(b) { b.classList.remove('active'); });
      this.classList.add('active');
      document.getElementById('exam-result-list').innerHTML = this.dataset.view === 'wrong' ? wrongItemsHtml : allItemsHtml;
    });
  });
}

// ========== Wrong Questions ==========
function renderWrongList() {
  const app = document.getElementById('app');
  const wrongIds = Storage.getWrongIds();
  const wrongQs = wrongIds.map(id => getQ(id)).filter(Boolean);
  let typeFilter = 'all';
  let topicFilter = 'all';

  function applyFilter() {
    var filtered = wrongQs;
    if (typeFilter !== 'all') filtered = filtered.filter(function(q) { return q.type === typeFilter; });
    if (topicFilter !== 'all') {
      if (topicFilter === '综合老题库') filtered = filtered.filter(function(q) { return !q.tags || !q.tags[0]; });
      else filtered = filtered.filter(function(q) { return q.tags && q.tags[0] === topicFilter; });
    }
    renderListItems(filtered, 'list-wrong', true, false);
    var statsEl = document.getElementById('stats-wrong');
    if (statsEl) statsEl.textContent = '共 ' + wrongQs.length + ' 道错题 | 筛选 ' + filtered.length + ' 道';
  }

  var topicDropdownHtml = buildTopicDropdownHTML('wrong', 'all', true, false);

  app.innerHTML = `
    <div class="stats-bar" id="stats-wrong">共 ${wrongQs.length} 道错题</div>
    <div class="filter-bar">
      <div class="filter-row">
        <span class="filter-label">精选专题：</span>${topicDropdownHtml}
      </div>
      <div class="filter-row">
        <span class="filter-label">题型：</span>
        <button class="filter-chip active" data-type="all">全部</button>
        <button class="filter-chip" data-type="single">单选</button>
        <button class="filter-chip" data-type="multiple">多选</button>
      </div>
    </div>
    <div id="list-wrong"></div>
  `;

  renderListItems(wrongQs, 'list-wrong', true, false);

  // Topic dropdown
  bindTopicDropdown('wrong', function(val) { topicFilter = val; applyFilter(); });

  // Type chips
  document.querySelectorAll('[data-type]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('[data-type]').forEach(function(b) { b.classList.remove('active'); });
      this.classList.add('active');
      typeFilter = this.dataset.type;
      applyFilter();
    });
  });
}

// ========== Favorites ==========
function renderFavList() {
  const app = document.getElementById('app');
  const favIds = Storage.getFavIds();
  const favQs = favIds.map(id => getQ(id)).filter(Boolean);
  let typeFilter = 'all';
  let topicFilter = 'all';

  function applyFilter() {
    var filtered = favQs;
    if (typeFilter !== 'all') filtered = filtered.filter(function(q) { return q.type === typeFilter; });
    if (topicFilter !== 'all') {
      if (topicFilter === '综合老题库') filtered = filtered.filter(function(q) { return !q.tags || !q.tags[0]; });
      else filtered = filtered.filter(function(q) { return q.tags && q.tags[0] === topicFilter; });
    }
    renderListItems(filtered, 'list-fav', false, true);
    var statsEl = document.getElementById('stats-fav');
    if (statsEl) statsEl.textContent = '共 ' + favQs.length + ' 道收藏 | 筛选 ' + filtered.length + ' 道';
  }

  var topicDropdownHtml = buildTopicDropdownHTML('fav', 'all', true, false);

  app.innerHTML = `
    <div class="stats-bar" id="stats-fav">共 ${favQs.length} 道收藏</div>
    <div class="filter-bar">
      <div class="filter-row">
        <span class="filter-label">精选专题：</span>${topicDropdownHtml}
      </div>
      <div class="filter-row">
        <span class="filter-label">题型：</span>
        <button class="filter-chip active" data-type="all">全部</button>
        <button class="filter-chip" data-type="single">单选</button>
        <button class="filter-chip" data-type="multiple">多选</button>
      </div>
    </div>
    <div id="list-fav"></div>
  `;
  renderListItems(favQs, 'list-fav', false, true);

  // Topic dropdown
  bindTopicDropdown('fav', function(val) { topicFilter = val; applyFilter(); });

  // Type chips
  document.querySelectorAll('[data-type]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('[data-type]').forEach(function(b) { b.classList.remove('active'); });
      this.classList.add('active');
      typeFilter = this.dataset.type;
      applyFilter();
    });
  });
}
