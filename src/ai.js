// ====== 功能开关：true=开启 false=关闭 ======
var AI_ENABLED = true;

// ====== API 配置 ======
// Key 由 Cloudflare Worker 管理，前端不持有真实 Key
var AI_CONFIG = {
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'sk-f45440644b4747ef993eacb8ee66305c',
  model: 'deepseek-v4-flash'
};

// 系统提示词
var AI_SYSTEM_PROMPT = '你是入党积极分子培训辅导老师。请仔细审题，确保答案绝对正确后再输出。严格按以下格式，换行不空行：\n【考点】一句话\n【答案】正确选项（必须准确，不确定就标注不确定）\n【解析】逐项说明对错原因，每条一句话，150字内';

// HTML 转义
function _aiEscape(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 流式请求的定时器管理
var _aiTimers = {};

// 流式调用 AI API（兼容 OpenAI 格式）
// 检测浏览器是否支持 ReadableStream 流式读取
var _supportsStreaming = (function() {
  try { return !!new ReadableStream().getReader; } catch(e) { return false; }
})();

function streamAI(questionText, optionsText, onChunk, onDone, onError) {
  var url = AI_CONFIG.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  var userMsg = '【题目】' + questionText + '\n\n【选项】\n' + optionsText + '\n\n请解析。';
  var controller = new AbortController();
  var tKey = 'ai_' + Date.now() + '_' + Math.random();
  // 手机端网络较慢，非流式加大超时
  var timeoutMs = _supportsStreaming ? 10000 : 20000;
  _aiTimers[tKey] = setTimeout(function() { delete _aiTimers[tKey]; controller.abort(); }, timeoutMs);
  var useStream = _supportsStreaming;

  var reqBody = JSON.stringify({
    model: AI_CONFIG.model,
    messages: [
      { role: 'system', content: AI_SYSTEM_PROMPT },
      { role: 'user', content: userMsg }
    ],
    stream: useStream,
    temperature: 0.3,
    max_tokens: 300
  });

  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + AI_CONFIG.apiKey
    },
    body: reqBody,
    signal: controller.signal
  }).then(function(res) {
    clearTimeout(_aiTimers[tKey]); delete _aiTimers[tKey];
    if (!res.ok) {
      return res.text().then(function(t) {
        var msg;
        try { var j = JSON.parse(t); msg = j.error && j.error.message ? j.error.message : t; } catch(e) { msg = t.substring(0, 200); }
        throw new Error('API 错误 (' + res.status + '): ' + msg);
      }).catch(function(e) {
        throw new Error('API 错误 (' + res.status + '): 无法读取响应内容');
      });
    }
    // 非流式模式：直接解析 JSON 响应
    if (!useStream) {
      return res.json().then(function(data) {
        var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (content) {
          if (onChunk) onChunk(content);
          onDone();
        } else {
          onError('此题暂时无解析');
        }
      }).catch(function(e) { onError(e && e.message ? e.message : '解析失败'); });
    }
    var reader = res.body && res.body.getReader ? res.body.getReader() : null;
    if (!reader) { onError('浏览器不支持流式读取'); return; }
    var decoder = new TextDecoder('utf-8');
    var buffer = '';

    function read() {
      reader.read().then(function(r) {
        if (r.done) { onDone(); return; }
        buffer += decoder.decode(r.value, { stream: true });
        var lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (line === '[DONE]') { onDone(); return; }
          if (line.indexOf('data:') !== 0) continue;
          var jsonStr = line.substring(5).trim();
          if (jsonStr === '[DONE]') { onDone(); return; }
          try {
            var obj = JSON.parse(jsonStr);
            var delta = obj.choices && obj.choices[0] && obj.choices[0].delta;
            if (delta && delta.content) onChunk(delta.content);
          } catch(e) { console.warn('SSE parse:', e); }
        }
        read();
      }).catch(function(e) {
        if (e && e.name === 'AbortError') { onError('请求超时，请重试'); }
        else { onError(e && e.message ? e.message : '读取流失败'); }
      });
    }
    read();
  }).catch(function(e) {
    clearTimeout(_aiTimers[tKey]); delete _aiTimers[tKey];
    if (e && e.name === 'AbortError') { onError('请求超时，请重试'); }
    else if (e && e.message && e.message.indexOf('Failed to fetch') !== -1) {
      onError('网络请求失败，请检查网络连接或 API 是否支持跨域访问');
    } else { onError(e && e.message ? e.message : '请求失败'); }
  });

  return { controller: controller, timerKey: tKey };
}

// 预置解析（硬编码，不占 localStorage 空间）
var _AI_PRESETS = {
  'q_001196': '【考点】党的二十届四中全会审议通过的重要文件是《中共中央关于制定国民经济和社会发展第十五个五年规划的建议》。\n【答案】B\n【解析】A项是党的十九届三中全会审议通过的机构改革相关文件，不符合题干；B项与全会公报原文一致，正确；C项是"十四五"规划纲要，不是二十届四中全会文件；D项是党的二十届三中全会审议通过的改革决定，不符合题干。'
};

// 分析结果缓存 — 存入 Storage.questions[qid].aiAnalysis
var AICache = {
  _maxSize: 300,

  get: function(qid) {
    var preset = _AI_PRESETS[qid];
    if (preset) return preset;
    var s = Storage.getQ(qid);
    return s.aiAnalysis || null;
  },

  set: function(qid, text) {
    var s = Storage.getQ(qid);
    s.aiAnalysis = text;
    s._aiCachedAt = Date.now();
    var saved = Storage.save();
    if (!saved) {
      // 保存失败（配额满等）：回滚内存保持与磁盘一致，避免静默丢失
      delete s.aiAnalysis;
      delete s._aiCachedAt;
      return;
    }
    // 仅在保存成功后 trim，避免 trim 删除与 save 失败的不一致
    this._trim();
  },

  _trim: function() {
    var d = Storage.load();
    var cached = [];
    for (var id in d.questions) {
      if (d.questions[id].aiAnalysis) {
        cached.push({ id: id, time: d.questions[id]._aiCachedAt || 0 });
      }
    }
    if (cached.length <= this._maxSize) return;
    cached.sort(function(a, b) { return a.time - b.time; });
    var remove = cached.length - this._maxSize;
    for (var i = 0; i < remove; i++) {
      var q = d.questions[cached[i].id];
      if (q) { delete q.aiAnalysis; delete q._aiCachedAt; }
    }
    if (!Storage.save()) {
      Storage._data = null;
    }
  }
};

// 面板 UI 状态同步 — prefetch 完成/失败后若面板已展开则更新 DOM
function _updatePanelUI() {
  var el = document.getElementById('ai-content');
  if (!el) return;
  el.classList.remove('streaming');
  var panel = document.getElementById('ai-panel');
  if (panel) {
    var span = panel.querySelector('.ai-panel-header span');
    if (span) span.textContent = '解析';
  }
  var btn = document.getElementById('btn-ai-stop');
  if (btn) { btn.textContent = '✕'; btn.id = 'btn-ai-close'; }
}

// 解析面板管理
var AIPanel = {
  _streaming: false,
  _content: '',
  _streamHandle: null,
  _generation: 0,

  isStreaming: function() { return this._streaming; },
  isOpen: function() { return !!document.getElementById('ai-panel'); },

  // 中止当前流式请求（如有）
  _abortStream: function() {
    if (this._streamHandle) {
      if (this._streamHandle.controller) {
        try { this._streamHandle.controller.abort(); } catch(e) {}
      }
      if (this._streamHandle.timerKey) {
        clearTimeout(_aiTimers[this._streamHandle.timerKey]);
        delete _aiTimers[this._streamHandle.timerKey];
      }
      this._streamHandle = null;
    }
  },

  // 显示缓存内容
  showCached: function(text) {
    var container = document.getElementById('ai-panel-container');
    if (!container) return;
    container.innerHTML =
      '<div class="ai-panel" id="ai-panel">' +
        '<div class="ai-panel-header">' +
          '<span>解析</span>' +
          '<button class="ai-panel-close" id="btn-ai-close">✕</button>' +
        '</div>' +
        '<div class="ai-content" id="ai-content">' + _aiEscape(text) + '</div>' +
      '</div>';
    document.getElementById('btn-ai-close').addEventListener('click', function() { AIPanel.close(); });
  },

  // 发起流式解析
  open: function(q, onComplete) {
    var self = this;
    var container = document.getElementById('ai-panel-container');
    if (!container || !q) return;

    // 中止上一次未完成的请求
    self._abortStream();
    self._generation++;
    var gen = self._generation;
    self._content = '';
    self._streaming = true;

    container.innerHTML =
      '<div class="ai-panel" id="ai-panel">' +
        '<div class="ai-panel-header">' +
          '<span>解析中…</span>' +
          '<button class="ai-panel-close" id="btn-ai-stop">✕</button>' +
        '</div>' +
        '<div class="ai-loading" id="ai-loading-el">' +
          '<span class="ai-loading-spinner"></span>' +
          '<span>正在解析…</span>' +
        '</div>' +
        '<div class="ai-content streaming" id="ai-content" style="display:none;"></div>' +
      '</div>';

    var contentEl = document.getElementById('ai-content');
    var loadingEl = document.getElementById('ai-loading-el');
    var headerSpan = container.querySelector('.ai-panel-header span');

    document.getElementById('btn-ai-stop').addEventListener('click', function() { self.close(); });

    var optsText = q.options.map(function(o) { return o.key + '. ' + o.text; }).join('\n');

    self._streamHandle = streamAI(q.question, optsText,
      function(chunk) {
        if (self._generation !== gen) return;
        if (loadingEl && loadingEl.parentNode) { loadingEl.style.display = 'none'; contentEl.style.display = 'block'; }
        self._content += chunk;
        contentEl.textContent = self._content;
        contentEl.scrollTop = contentEl.scrollHeight;
      },
      function() {
        if (self._generation !== gen) return;
        self._streaming = false;
        self._streamHandle = null;
        contentEl.classList.remove('streaming');
        headerSpan.textContent = '解析';
        var stopBtn = document.getElementById('btn-ai-stop');
        if (stopBtn) { stopBtn.textContent = '✕'; stopBtn.id = 'btn-ai-close'; }
        AICache.set(q.id, self._content);
        if (onComplete) onComplete();
      },
      function(errMsg) {
        if (self._generation !== gen) {
          // 被新请求抢先：隐藏 loading 并显示已有内容
          if (loadingEl && loadingEl.parentNode) loadingEl.style.display = 'none';
          if (contentEl) {
            contentEl.style.display = 'block';
            contentEl.classList.remove('streaming');
            if (self._content) { contentEl.textContent = self._content; }
          }
          return;
        }
        self._streaming = false;
        self._streamHandle = null;
        console.warn('AI open failed:', errMsg);
        self._content = '此题暂时无解析';
        if (loadingEl && loadingEl.parentNode) loadingEl.style.display = 'none';
        contentEl.style.display = 'block';
        contentEl.classList.remove('streaming');
        contentEl.innerHTML = '<div class="ai-error">此题暂时无解析</div>';
        headerSpan.textContent = '解析';
        var stopBtn = document.getElementById('btn-ai-stop');
        if (stopBtn) { stopBtn.textContent = '✕'; stopBtn.id = 'btn-ai-close'; }
        if (onComplete) onComplete();
      }
    );
  },

  // 后台预加载 — 提交答案后自动发起请求，不显示面板
  prefetch: function(q) {
    var self = this;
    if (!q) return;

    self._abortStream();
    self._generation++;
    var gen = self._generation;
    self._content = '';
    self._streaming = true;

    var optsText = q.options.map(function(o) { return o.key + '. ' + o.text; }).join('\n');

    self._streamHandle = streamAI(q.question, optsText,
      function(chunk) {
        if (self._generation !== gen) return;
        self._content += chunk;
        var el = document.getElementById('ai-content');
        if (el) { el.textContent = self._content; el.scrollTop = el.scrollHeight; }
      },
      function() {
        if (self._generation !== gen) return;
        self._streaming = false;
        self._streamHandle = null;
        AICache.set(q.id, self._content);
        _updatePanelUI();
      },
      function(errMsg) {
        if (self._generation !== gen) return;
        self._streaming = false;
        self._streamHandle = null;
        console.warn('AI prefetch failed:', errMsg);
        self._content = '此题暂时无解析';
        _updatePanelUI();
      }
    );
  },

  // 展开预加载的面板（流式中 / 已完成）
  revealPrefetch: function() {
    var self = this;
    var container = document.getElementById('ai-panel-container');
    if (!container) return;

    var streaming = self._streaming;
    var isError = self._content && self._content.indexOf('此题暂时无解析') === 0;
    container.innerHTML =
      '<div class="ai-panel" id="ai-panel">' +
        '<div class="ai-panel-header">' +
          '<span>' + (streaming ? '解析中…' : isError ? '解析失败' : '解析') + '</span>' +
          '<button class="ai-panel-close" id="btn-ai-stop">✕</button>' +
        '</div>' +
        '<div class="ai-content' + (streaming ? ' streaming' : '') + '" id="ai-content">' +
          (isError ? '<div class="ai-error">' + _aiEscape(self._content) + '</div>' : _aiEscape(self._content)) +
        '</div>' +
      '</div>';

    document.getElementById('btn-ai-stop').addEventListener('click', function() { self.close(); });
  },

  close: function() {
    this._abortStream();
    this._generation++;
    this._streaming = false;
    this._content = '';
    var container = document.getElementById('ai-panel-container');
    if (container) container.innerHTML = '';
    var btn = document.getElementById('btn-ai-parse');
    if (btn) btn.textContent = '展开解析';
  }
};
