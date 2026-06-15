// ====== 版本更新时是否清空 AI 解析缓存 ======
var CLEAR_AI_CACHE_ON_UPDATE = false;

// localStorage-based user state management
const STORAGE_KEY = 'party_exam_state';
const HISTORY_KEY = 'party_exam_history';

const Storage = {
  _data: null,

  _default() {
    return {
      questions: {},     // questionId -> {attempts, wrongCount, correctStreak, lastSeenIdx, nextReviewIdx, isFavorite, isWrong}
      practiceIdx: 0,    // total questions attempted (used for review scheduling)
      practiceMode: 'topic',  // 'random' | 'sequential' | 'topic'
      sequentialIdx: 0,        // current question index for sequential mode
      topicIdx: 0,             // current question index for topic mode
      topicName: '作者精选题库',           // selected topic name for topic mode
    };
  },

  load() {
    if (this._data) return this._data;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Migrate old data — ensure new fields exist; persist immediately
        var needsSave = false;
        if (!parsed.practiceMode) { parsed.practiceMode = 'topic'; needsSave = true; }
        if (parsed.sequentialIdx == null) { parsed.sequentialIdx = 0; needsSave = true; }
        if (parsed.topicIdx == null) { parsed.topicIdx = 0; needsSave = true; }
        if (!parsed.topicName) { parsed.topicName = '作者精选题库'; needsSave = true; }
        // Migrate old topic name to new name
        if (parsed.topicName === '综合高难度易错题库') { parsed.topicName = '党的二十届四中全会精神'; needsSave = true; }
        if (parsed.topicName === '其他') { parsed.topicName = '综合老题库'; needsSave = true; }
        // 版本更新时清空 AI 解析缓存（由 CLEAR_AI_CACHE_ON_UPDATE 控制）
        if (CLEAR_AI_CACHE_ON_UPDATE) {
        var curVer = window.__VERSION || '';
        if (parsed._version !== curVer) {
          for (var qid in parsed.questions) {
            if (parsed.questions[qid].aiAnalysis) {
              delete parsed.questions[qid].aiAnalysis;
              delete parsed.questions[qid]._aiCachedAt;
              needsSave = true;
            }
          }
          parsed._version = curVer;
        }
        } // CLEAR_AI_CACHE_ON_UPDATE
        this._data = parsed;
        if (needsSave) {
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed)); } catch(e) {}
        }
      } else {
        this._data = this._default();
      }
    } catch (e) {
      console.warn('Storage load failed, resetting:', e);
      // 备份损坏数据以便恢复，避免用户数据永久丢失
      try { localStorage.setItem(STORAGE_KEY + '_corrupted_backup', raw || ''); } catch(ignore) {}
      this._data = this._default();
    }
    return this._data;
  },

  save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this._data)); return true; } catch (e) { console.warn('Storage save failed:', e); if (!Storage._saveAlertShown) { Storage._saveAlertShown = true; alert('存储空间不足，请清理浏览器数据后刷新页面'); } return false; }
  },

  reset() {
    this._data = this._default();
    this.save();
  },

  // Question state getters/setters
  getQ(qid) {
    const d = this.load();
    if (!d.questions[qid]) {
      d.questions[qid] = {
        attempts: 0, wrongCount: 0, correctStreak: 0,
        lastSeenIdx: -1, nextReviewIdx: -1,
        isFavorite: false, isWrong: false
      };
    }
    return d.questions[qid];
  },

  // 内部：统计一道题的作答结果（不调用 save）
  _recordOne(qid, isCorrect, d) {
    var s = this.getQ(qid);
    s.attempts++;
    s.lastSeenIdx = d.practiceIdx;
    var myPracticeIdx = d.practiceIdx;  // 捕获递增前的值，避免批次中后续题目被抬高
    d.practiceIdx++;
    if (isCorrect) {
      s.correctStreak++;
      // 间隔重复：需连续答对2次才清除错题标记，防止单次蒙对
      if (s.correctStreak >= 2) {
        s.isWrong = false; s.wrongCount = 0; s.correctStreak = 0; s.nextReviewIdx = -1;
      }
    } else {
      s.correctStreak = 0; s.wrongCount++; s.isWrong = true;
      var intervals = [3, 5, 8, 12, 18, 25];
      var interval = intervals[Math.min(s.wrongCount - 1, intervals.length - 1)];
      s.nextReviewIdx = myPracticeIdx + interval;
    }
  },

  // Record an attempt
  recordAttempt(qid, isCorrect) {
    var d = this.load();
    this._recordOne(qid, isCorrect, d);
    this.save();
  },

  // Check if a question is due for review (wrong question review)
  isDueForReview(qid) {
    const d = this.load();
    const s = this.getQ(qid);
    if (!s.isWrong) return false;
    if (s.nextReviewIdx < 0) return true;
    return d.practiceIdx >= s.nextReviewIdx;
  },

  // 批量记录答题结果 — 只写一次 localStorage，避免 submitExam 中 50 次同步写入卡顿
  batchRecordAttempt(records) {
    var d = this.load();
    for (var i = 0; i < records.length; i++) {
      this._recordOne(records[i].qid, records[i].isCorrect, d);
    }
    return this.save();
  },

  // Favorite
  toggleFavorite(qid) {
    const s = this.getQ(qid);
    s.isFavorite = !s.isFavorite;
    this.save();
    return s.isFavorite;
  },

  isFavorite(qid) {
    return this.getQ(qid).isFavorite;
  },

  // Wrong list
  getWrongIds() {
    const d = this.load();
    return Object.keys(d.questions).filter(id => d.questions[id].isWrong);
  },

  removeWrong(qid) {
    const s = this.getQ(qid);
    s.isWrong = false;
    s.wrongCount = 0;
    s.correctStreak = 0;
    s.nextReviewIdx = -1;
    this.save();
  },

  getFavIds() {
    const d = this.load();
    return Object.keys(d.questions).filter(id => d.questions[id].isFavorite);
  },

  // Practice mode
  getMode() {
    return this.load().practiceMode;
  },
  setMode(mode) {
    this.load().practiceMode = mode;
    this.save();
  },
  getSequentialIdx() {
    return this.load().sequentialIdx;
  },
  setSequentialIdx(idx) {
    this.load().sequentialIdx = Math.max(0, idx);
    this.save();
  },
  getTopicName() {
    return this.load().topicName;
  },
  setTopicName(name) {
    this.load().topicName = name;
    this.save();
  },
  getTopicIdx() {
    return this.load().topicIdx;
  },
  setTopicIdx(idx) {
    this.load().topicIdx = Math.max(0, idx);
    this.save();
  },

  // Stats
  getStats() {
    const d = this.load();
    const allIds = Object.keys(d.questions);
    return {
      totalAttempted: allIds.filter(id => d.questions[id].attempts > 0).length,
      totalWrong: allIds.filter(id => d.questions[id].isWrong).length,
      totalFav: allIds.filter(id => d.questions[id].isFavorite).length,
    };
  }
};

// History management — stores practice session history
// Model: _stack stores all visited questions. _cursor points to current position.
// hasPrev = cursor > 0, back() moves cursor back, forward exists for symmetry.
const PracticeHistory = {
  _stack: [],
  _cursor: -1,

  load() {
    // _stack === null (sentinel) means multi-tab sync invalidated cache → reload from disk
    if (this._stack !== null) return this._stack;
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const data = raw ? JSON.parse(raw) : null;
      if (data && Array.isArray(data.stack)) {
        this._stack = data.stack;
        this._cursor = Math.min(
          Math.max(data.cursor ?? (this._stack.length - 1), -1),
          this._stack.length - 1
        );
      } else {
        this._stack = [];
        this._cursor = -1;
      }
    } catch (e) {
      console.warn('History load failed, resetting:', e);
      this._stack = [];
      this._cursor = -1;
    }
    return this._stack;
  },

  save() {
    this.load();
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify({
        stack: this._stack.slice(-300),
        cursor: Math.min(this._cursor, this._stack.length - 1)
      }));
    } catch (e) { console.warn('History save failed:', e); }
  },

  // Add entry at current cursor position (truncates forward history)
  push(entry) {
    this.load();
    this._cursor++;
    // Truncate any forward history and add new entry
    this._stack = this._stack.slice(0, this._cursor);
    this._stack.push(entry);
    if (this._stack.length > 300) {
      const diff = this._stack.length - 300;
      this._stack = this._stack.slice(diff);
      this._cursor -= diff;
    }
    this.save();
  },

  // Update the current entry (e.g., after submitting an answer)
  updateCurrent(updates) {
    this.load();
    if (this._cursor >= 0 && this._cursor < this._stack.length) {
      Object.assign(this._stack[this._cursor], updates);
    }
    this.save();
  },

  // 预览前一条历史记录，不移动光标（用于 prevQuestion 中先验证后移动）
  peekPrev() {
    this.load();
    if (this._cursor <= 0) return null;
    return this._stack[this._cursor - 1] || null;
  },

  // Go back one step
  back() {
    this.load();
    if (this._cursor <= 0) return null;
    this._cursor--;
    this.save();
    return this._stack[this._cursor];
  },

  // Current entry
  current() {
    this.load();
    if (this._cursor < 0 || this._cursor >= this._stack.length) return null;
    return this._stack[this._cursor];
  },

  hasPrev() {
    this.load();
    return this._cursor > 0;
  },

  clear() {
    this._stack = [];
    this._cursor = -1;
    this.save();
  }
};

// 多标签页同步：当其他标签页修改 localStorage 时，清除内存缓存以强制重新加载
window.addEventListener('storage', function(e) {
  if (e.key === STORAGE_KEY) { Storage._data = null; }
  if (e.key === HISTORY_KEY) { /* invalidate cache only — load() will re-read from localStorage */ PracticeHistory._stack = null; PracticeHistory._cursor = null; }
});

