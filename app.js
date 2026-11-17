/* ==========================================================================
   OBEC Exam Academy — Core Application Logic (Bug-Free & Offline-Ready)
   ========================================================================== */

(function () {
    'use strict';

    var $ = function (sel) { return document.querySelector(sel); };
    var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

    /* ----------------------------------------------------------------------
       Safe Escaping & Hashing (Works on file://, http://, and https://)
       ---------------------------------------------------------------------- */
    function esc(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function hashSecret(str) {
        var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
        for (var i = 0; i < str.length; i++) {
            var ch = str.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
    }

    function todayKey() {
        var d = new Date();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return d.getFullYear() + '-' + m + '-' + day;
    }

    function yesterdayKey() {
        var d = new Date(Date.now() - 86400000);
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return d.getFullYear() + '-' + m + '-' + day;
    }

    /* ----------------------------------------------------------------------
       Safe LocalStorage Wrapper
       ---------------------------------------------------------------------- */
    var store = {
        get: function (key, fallback) {
            try {
                var raw = localStorage.getItem(key);
                return raw ? JSON.parse(raw) : fallback;
            } catch (e) {
                return fallback;
            }
        },
        set: function (key, val) {
            try {
                localStorage.setItem(key, JSON.stringify(val));
            } catch (e) { }
        }
    };

    /* ----------------------------------------------------------------------
       Data Indexing (Topics, Quizzes, Flashcards)
       ---------------------------------------------------------------------- */
    var CAT_META = {
        a: { color: '#2563eb', icon: 'ก', short: 'ภาค ก' },
        b: { color: '#7c3aed', icon: 'ข๑', short: 'ข ส่วน 1' },
        c: { color: '#0d9488', icon: 'ข๒', short: 'ข ส่วน 2' },
        d: { color: '#ea580c', icon: 'ค', short: 'ภาค ค' }
    };

    var FLAT_TOPICS = [];
    var ALL_QUESTIONS = [];
    var ALL_FLASHCARDS = [];

    D.forEach(function (cat) {
        cat.s.forEach(function (sec, idx) {
            var key = cat.id + '/' + idx;
            FLAT_TOPICS.push({
                k: key,
                c: cat.id,
                catTitle: cat.t,
                t: sec.t,
                idx: idx
            });
            sec.b.forEach(function (blk) {
                if (blk.k === 'quiz' && Array.isArray(blk.qs)) {
                    blk.qs.forEach(function (q, qIdx) {
                        ALL_QUESTIONS.push({
                            uid: blk.id + '_' + qIdx,
                            quizId: blk.id,
                            catId: cat.id,
                            topicKey: key,
                            topicTitle: sec.t,
                            q: q[0],
                            opts: q[1],
                            ans: q[2],
                            exp: q[3]
                        });
                    });
                }
                if (blk.k === 'fc' && Array.isArray(blk.c)) {
                    blk.c.forEach(function (card, cIdx) {
                        ALL_FLASHCARDS.push({
                            uid: blk.id + '_' + cIdx,
                            fcId: blk.id,
                            cardIdx: cIdx,
                            catId: cat.id,
                            topicTitle: sec.t,
                            front: card[0],
                            back: card[1]
                        });
                    });
                }
            });
        });
    });

    /* ----------------------------------------------------------------------
       Email Authentication & Per-User Progress State
       ---------------------------------------------------------------------- */
    var USERS_KEY = 'obec_users_v2';
    var SESSION_KEY = 'obec_session_v2';
    var currentUser = null;
    var P = null;

    function defaultProgress() {
        return {
            v: {},          // บทเรียนที่เรียนจบแล้ว { "a/0": 1 }
            qz: {},         // คะแนนล่าสุดรายชุด { "a0": { score: 3, total: 4 } }
            qLog: {},       // ประวัติการตอบรายข้อ { "a0_0": true/false }
            mistakes: [],   // รายการข้อที่เคยตอบผิด [uid, ...]
            fc: {},         // บัตรคำที่จำได้ { "b6": [0, 1] }
            xp: 0,          // คะแนน XP สะสม
            streak: 0,      // วันต่อเนื่อง
            activeDays: {}, // ประวัติวันที่เข้าเรียน { "2026-11-18": true }
            daily: {
                date: todayKey(),
                xp: 0,
                answered: 0,
                passed80: 0
            },
            examDate: '',   // วันสอบเป้าหมาย YYYY-MM-DD
            fs: 16,         // ขนาดตัวอักษร
            theme: ''       // light / dark / ''
        };
    }

    function normalizeProgress(raw) {
        var base = defaultProgress();
        if (!raw || typeof raw !== 'object') return base;
        var merged = Object.assign(base, raw);
        merged.v = merged.v || {};
        merged.qz = merged.qz || {};
        merged.qLog = merged.qLog || {};
        merged.mistakes = Array.isArray(merged.mistakes) ? merged.mistakes : [];
        merged.fc = merged.fc || {};
        merged.activeDays = merged.activeDays || {};
        merged.xp = Number(merged.xp) || 0;
        merged.streak = Number(merged.streak) || 0;
        merged.fs = Math.min(24, Math.max(13, Number(merged.fs) || 16));

        var tk = todayKey();
        if (!merged.daily || merged.daily.date !== tk) {
            merged.daily = { date: tk, xp: 0, answered: 0, passed80: 0 };
        }
        return merged;
    }

    function userDataKey(email) {
        return 'obec_data_' + email.toLowerCase().trim();
    }

    function save() {
        if (!currentUser || !P) return;
        store.set(userDataKey(currentUser.email), P);
        updateTopbarStats();
    }

    function recordActivity(xpGain, answeredGain, passed80Gain) {
        if (!P) return;
        var tk = todayKey();
        var yk = yesterdayKey();

        if (!P.activeDays[tk]) {
            P.activeDays[tk] = true;
            if (P.activeDays[yk]) {
                P.streak = (P.streak || 0) + 1;
            } else {
                P.streak = 1;
            }
        }

        if (P.daily.date !== tk) {
            P.daily = { date: tk, xp: 0, answered: 0, passed80: 0 };
        }

        P.xp += (xpGain || 0);
        P.daily.xp += (xpGain || 0);
        P.daily.answered += (answeredGain || 0);
        P.daily.passed80 += (passed80Gain || 0);
        save();
    }

    function applyPreferences() {
        if (!P) return;
        document.documentElement.style.setProperty('--fs', P.fs + 'px');
        if (P.theme === 'dark' || P.theme === 'light') {
            document.documentElement.dataset.theme = P.theme;
        } else {
            delete document.documentElement.dataset.theme;
        }
    }

    function loadUserSession(userObj) {
        currentUser = userObj;
        store.set(SESSION_KEY, { email: userObj.email });
        P = normalizeProgress(store.get(userDataKey(userObj.email), null));

        // เช็คว่าถ้าเมื่อวานไม่ได้เข้าเรียนและวันนี้ยังไม่เริ่ม ให้รีเซ็ต streak แสดงผลเป็น 0
        var tk = todayKey();
        var yk = yesterdayKey();
        if (!P.activeDays[tk] && !P.activeDays[yk]) {
            P.streak = 0;
        }

        applyPreferences();
        updateUserHeader();
        updateCountdownSidebar();
        updateTopbarStats();

        $('#auth-screen').hidden = true;
        $('#app-shell').hidden = false;
        $('#tabs').hidden = false;
        route();
    }

    function updateUserHeader() {
        if (!currentUser) return;
        var name = currentUser.name || currentUser.email.split('@')[0];
        var initial = name.charAt(0).toUpperCase();
        $('#user-avatar').textContent = initial;
        $('#user-display-name').textContent = name;
        $('#ud-name').textContent = name;
        $('#ud-email').textContent = currentUser.email;
    }

    function updateTopbarStats() {
        if (!P) return;
        $('#hdr-streak').textContent = P.streak || 0;
        $('#hdr-xp').textContent = P.xp || 0;
    }

    function getCountdownInfo() {
        if (!P || !P.examDate) return null;
        var parts = P.examDate.split('-');
        if (parts.length !== 3) return null;
        var target = new Date(+parts[0], +parts[1] - 1, +parts[2]);
        var now = new Date();
        var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var diff = Math.ceil((target - today) / 86400000);
        var thMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
        var thFullMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
        var beYear = +parts[0] + 543;
        return {
            days: diff,
            shortText: (+parts[2]) + ' ' + thMonths[+parts[1] - 1] + ' · ' + (diff >= 0 ? diff + ' วัน' : 'ผ่านแล้ว'),
            fullText: (+parts[2]) + ' ' + thFullMonths[+parts[1] - 1] + ' ' + beYear
        };
    }

    function updateCountdownSidebar() {
        var info = getCountdownInfo();
        $('#sb-countdown-text').textContent = info ? info.shortText : 'ตั้งวันสอบ · คลิกแก้ไข';
    }

    /* ----------------------------------------------------------------------
       Auth Screen Controller
       ---------------------------------------------------------------------- */
    var authMode = 'login';

    function setAuthMode(mode) {
        authMode = mode;
        $$('.auth-tab').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.authMode === mode);
        });
        $('#auth-name-group').hidden = (mode !== 'register');
        $('#auth-submit').textContent = (mode === 'register')
            ? 'สร้างบัญชีและเริ่มติวสอบ'
            : 'เข้าสู่ระบบด้วย Email';
        $('#auth-error').hidden = true;
    }

    function showAuthError(msg) {
        var box = $('#auth-error');
        box.textContent = msg;
        box.hidden = false;
    }

    function renderSavedAccounts() {
        var users = store.get(USERS_KEY, {});
        var emails = Object.keys(users);
        var box = $('#saved-accounts-box');
        var list = $('#saved-accounts-list');
        if (!emails.length) {
            box.hidden = true;
            return;
        }
        box.hidden = false;
        list.innerHTML = emails.map(function (em) {
            var u = users[em];
            return (
                '<button type="button" class="saved-acc-btn" data-quick-email="' + esc(em) + '">' +
                '<span>👤 <b>' + esc(u.name || em.split('@')[0]) + '</b> <span class="mu">(' + esc(em) + ')</span></span>' +
                '<span style="color:var(--pr);font-weight:700">เข้าใช้งาน →</span>' +
                '</button>'
            );
        }).join('');

        $$('[data-quick-email]').forEach(function (btn) {
            btn.onclick = function () {
                var em = btn.dataset.quickEmail;
                var u = users[em];
                if (u) loadUserSession(u);
            };
        });
    }

    function openAuthScreen() {
        $('#app-shell').hidden = true;
        $('#tabs').hidden = true;
        $('#user-dropdown').hidden = true;
        $('#auth-screen').hidden = false;
        renderSavedAccounts();
    }

    $$('.auth-tab').forEach(function (tab) {
        tab.onclick = function () { setAuthMode(tab.dataset.authMode); };
    });

    $('#toggle-pass').onclick = function () {
        var inp = $('#auth-pass');
        inp.type = (inp.type === 'password') ? 'text' : 'password';
    };

    $('#auth-form').onsubmit = function (e) {
        e.preventDefault();
        var email = $('#auth-email').value.trim().toLowerCase();
        var pass = $('#auth-pass').value;
        var nameInput = $('#auth-name').value.trim();

        var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
        if (!emailRegex.test(email)) {
            showAuthError('กรุณากรอกรูปแบบ Email ให้ถูกต้อง (เช่น name@example.com)');
            $('#auth-email').focus();
            return;
        }
        if (!pass || pass.length < 4) {
            showAuthError('กรุณากรอกรหัสผ่านอย่างน้อย 4 ตัวอักษร');
            $('#auth-pass').focus();
            return;
        }

        var users = store.get(USERS_KEY, {});
        var hashed = hashSecret(email + ':' + pass);

        if (authMode === 'register') {
            if (users[email]) {
                showAuthError('อีเมลนี้มีบัญชีอยู่แล้ว กรุณากดแท็บ "เข้าสู่ระบบ"');
                return;
            }
            var newUser = {
                email: email,
                name: nameInput || email.split('@')[0],
                passHash: hashed,
                createdAt: Date.now()
            };
            users[email] = newUser;
            store.set(USERS_KEY, users);
            loadUserSession(newUser);
        } else {
            var existing = users[email];
            if (!existing) {
                showAuthError('ไม่พบบัญชีอีเมลนี้ กรุณากดแท็บ "สมัครสมาชิกใหม่" เพื่อสร้างบัญชี');
                return;
            }
            if (existing.passHash !== hashed) {
                showAuthError('รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง');
                $('#auth-pass').focus();
                return;
            }
            loadUserSession(existing);
        }
    };

    $('#demo-login-btn').onclick = function () {
        var users = store.get(USERS_KEY, {});
        var demoEmail = 'demo@obec-academy.th';
        if (!users[demoEmail]) {
            users[demoEmail] = {
                email: demoEmail,
                name: 'ผู้เข้าสอบ สพฐ. (Demo)',
                passHash: hashSecret(demoEmail + ':demo'),
                createdAt: Date.now()
            };
            store.set(USERS_KEY, users);
        }
        loadUserSession(users[demoEmail]);
    };

    /* ----------------------------------------------------------------------
       HTML Helpers & Interactive Components (Quiz, Flashcards, Subnet)
       ---------------------------------------------------------------------- */
    function renderTable(headers, rows) {
        return (
            '<div class="tw"><table><thead><tr>' +
            headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') +
            '</tr></thead><tbody>' +
            rows.map(function (r) {
                return '<tr>' + r.map(function (cell) { return '<td>' + cell + '</td>'; }).join('') + '</tr>';
            }).join('') +
            '</tbody></table></div>'
        );
    }

    function renderQuizBlock(container, blk, topicKey) {
        var total = blk.qs.length;
        var done = 0;
        var score = 0;
        var prev = P.qz[blk.id];

        container.innerHTML =
            '<h3>📝 แบบทดสอบเช็กความเข้าใจ ' +
            (prev ? '<span class="mu">(คะแนนล่าสุด ' + prev.score + '/' + prev.total + ')</span>' : '') +
            '</h3><div id="qz-sum-' + esc(blk.id) + '"></div>';

        blk.qs.forEach(function (q, qIdx) {
            var uid = blk.id + '_' + qIdx;
            var qBox = document.createElement('div');
            qBox.className = 'q';
            qBox.innerHTML = '<div class="q-title">' + (qIdx + 1) + '. ' + esc(q[0]) + '</div>';

            var answered = false;
            q[1].forEach(function (optText, optIdx) {
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'o';
                btn.textContent = optText;

                btn.onclick = function () {
                    if (answered) return;
                    answered = true;

                    var allBtns = qBox.querySelectorAll('.o');
                    allBtns.forEach(function (b) { b.disabled = true; });
                    allBtns[q[2]].classList.add('ok');

                    var isCorrect = (optIdx === q[2]);
                    if (isCorrect) {
                        score++;
                        P.qLog[uid] = true;
                        P.mistakes = P.mistakes.filter(function (m) { return m !== uid; });
                        recordActivity(5, 1, 0);
                    } else {
                        btn.classList.add('no');
                        P.qLog[uid] = false;
                        if (P.mistakes.indexOf(uid) < 0) P.mistakes.push(uid);
                        recordActivity(1, 1, 0);
                    }

                    var exp = document.createElement('div');
                    exp.className = 'q-exp';
                    exp.textContent = '💡 เฉลย: ' + q[3];
                    qBox.appendChild(exp);

                    done++;
                    if (done === total) {
                        var pct = Math.round((score / total) * 100);
                        var passed = pct >= 80 ? 1 : 0;
                        P.qz[blk.id] = { score: score, total: total };

                        // บันทึกว่าเรียนจบบทนี้เฉพาะเมื่อทำแบบทดสอบผ่านเกณฑ์ ≥ 80%
                        if (passed && topicKey && !P.v[topicKey]) {
                            P.v[topicKey] = 1;
                            recordActivity(10, 0, 0);
                            renderSidebar(topicKey);
                        }

                        recordActivity(passed ? 15 : 5, 0, passed);

                        var sumEl = container.querySelector('#qz-sum-' + blk.id);
                        if (sumEl) {
                            sumEl.innerHTML =
                                '<div class="quiz-summary">' +
                                (passed ? '🎉 ยอดเยี่ยม! ผ่านเกณฑ์ ' : '📌 สรุปผล: ') +
                                'ได้ ' + score + ' / ' + total + ' คะแนน (' + pct + '%)' +
                                (passed ? ' · บันทึกจบบทเรียน & รับโบนัส +15 XP' : ' · ต้องได้ ≥ 80% เพื่อบันทึกจบบทนี้') +
                                '</div>';
                        }
                    }
                };

                qBox.appendChild(btn);
            });

            container.appendChild(qBox);
        });
    }

    function renderFlashcardBlock(container, blk) {
        var idx = 0;
        var flipped = false;
        var cards = blk.c.slice();
        if (!Array.isArray(P.fc[blk.id])) P.fc[blk.id] = [];
        var known = P.fc[blk.id];

        function draw() {
            var item = cards[idx];
            container.innerHTML =
                '<h3>🗂️ Flashcards ท่องจำ <span class="mu">(จำได้แล้ว ' + known.length + '/' + cards.length + ')</span></h3>' +
                '<div class="fc" title="คลิกเพื่อพลิกการ์ด">' + (flipped ? item[1] : item[0]) + '</div>' +
                '<div class="mu" style="text-align:center;margin-top:8px">' +
                (idx + 1) + ' / ' + cards.length + ' · แตะที่การ์ดเพื่อพลิกดู' + (flipped ? 'คำถาม' : 'คำตอบ') +
                '</div>' +
                '<div class="row" style="justify-content:center">' +
                '<button type="button" class="btn-outline" id="fc-prev">◀ ก่อนหน้า</button>' +
                '<button type="button" class="btn-primary" id="fc-know">✔ จำได้แล้ว (+3 XP)</button>' +
                '<button type="button" class="btn-outline" id="fc-next">ถัดไป ▶</button>' +
                '<button type="button" class="btn-outline" id="fc-shuf">🔀 สลับการ์ด</button>' +
                '</div>';

            container.querySelector('.fc').onclick = function () {
                flipped = !flipped;
                draw();
            };
            container.querySelector('#fc-prev').onclick = function () {
                idx = (idx + cards.length - 1) % cards.length;
                flipped = false;
                draw();
            };
            container.querySelector('#fc-next').onclick = function () {
                idx = (idx + 1) % cards.length;
                flipped = false;
                draw();
            };
            container.querySelector('#fc-know').onclick = function () {
                if (known.indexOf(idx) < 0) {
                    known.push(idx);
                    recordActivity(3, 0, 0);
                } else {
                    save();
                }
                idx = (idx + 1) % cards.length;
                flipped = false;
                draw();
            };
            container.querySelector('#fc-shuf').onclick = function () {
                cards.sort(function () { return Math.random() - 0.5; });
                idx = 0;
                flipped = false;
                draw();
            };
        }

        draw();
    }

    function ipToInt(ipStr) {
        var parts = ipStr.split('.');
        if (parts.length !== 4) return null;
        var nums = [];
        for (var i = 0; i < 4; i++) {
            if (!/^\d+$/.test(parts[i])) return null;
            var n = Number(parts[i]);
            if (n < 0 || n > 255) return null;
            nums.push(n);
        }
        return ((nums[0] << 24) >>> 0) + (nums[1] << 16) + (nums[2] << 8) + nums[3];
    }

    function intToIp(num) {
        return [(num >>> 24) & 255, (num >>> 16) & 255, (num >>> 8) & 255, num & 255].join('.');
    }

    function attachSubnetTool(container) {
        var sel = container.querySelector('#cd');
        var btn = container.querySelector('#go');
        var ipInput = container.querySelector('#ip');
        var resBox = container.querySelector('#res');
        if (!sel || !btn || !ipInput || !resBox) return;

        sel.innerHTML = '';
        for (var c = 8; c <= 30; c++) {
            var opt = document.createElement('option');
            opt.value = String(c);
            opt.textContent = String(c);
            if (c === 24) opt.selected = true;
            sel.appendChild(opt);
        }

        function calc() {
            var ipNum = ipToInt(ipInput.value.trim());
            var cidr = Number(sel.value);
            if (ipNum === null) {
                resBox.innerHTML = '<p class="warn" style="margin-top:10px">รูปแบบ IPv4 ไม่ถูกต้อง (ตัวอย่าง: 192.168.10.77)</p>';
                return;
            }
            var mask = (0xFFFFFFFF << (32 - cidr)) >>> 0;
            var network = (ipNum & mask) >>> 0;
            var broadcast = (network | (~mask >>> 0)) >>> 0;
            var usableHosts = Math.pow(2, 32 - cidr) - 2;

            resBox.innerHTML = '<div style="margin-top:12px">' + renderTable(
                ['รายการ', 'ผลลัพธ์'],
                [
                    ['Network Address', '<code>' + intToIp(network) + '/' + cidr + '</code>'],
                    ['Subnet Mask', '<code>' + intToIp(mask) + '</code>'],
                    ['Broadcast Address', '<code>' + intToIp(broadcast) + '</code>'],
                    ['ช่วง Host ที่ใช้งานได้', '<code>' + intToIp(network + 1) + ' – ' + intToIp(broadcast - 1) + '</code>'],
                    ['จำนวน Host สูงสุด', '<b>' + usableHosts.toLocaleString() + '</b> เครื่อง']
                ]
            ) + '</div>';
        }

        btn.onclick = calc;
        calc();
    }

    /* ----------------------------------------------------------------------
       Sidebar & Mobile Tabs Navigation
       ---------------------------------------------------------------------- */
    function renderSidebar(currentRoute) {
        var catIcons = { a: '📐', b: '⚖️', c: '💻', d: '🎓' };
        var html = '';

        html += '<div class="sb-group-title">ภาพรวม</div>';
        html += navLink('#home', '⊞', 'Dashboard', currentRoute === 'home');
        html += navLink('#d/0', '📝', 'แนวข้อสอบสัมภาษณ์ & นโยบาย', currentRoute === 'd/0');

        html += '<div class="sb-group-title">เนื้อหา 4 หมวด</div>';
        D.forEach(function (cat) {
            var doneCount = cat.s.filter(function (_, i) { return !!P.v[cat.id + '/' + i]; }).length;
            var isCatActive = currentRoute.indexOf(cat.id + '/') === 0;
            html += navLink(
                '#' + cat.id + '/0',
                catIcons[cat.id] || '📘',
                cat.t,
                isCatActive,
                doneCount + '/' + cat.s.length
            );
            if (isCatActive) {
                cat.s.forEach(function (sec, idx) {
                    var k = cat.id + '/' + idx;
                    var seenMark = P.v[k] ? '✓' : '•';
                    html +=
                        '<a href="#' + k + '" class="nav-item ' + (currentRoute === k ? 'active' : '') + '" style="padding-left:28px;font-size:0.84em">' +
                        '<span class="nav-ic" style="font-size:0.85em;color:' + (P.v[k] ? 'var(--ok)' : 'var(--mu)') + '">' + seenMark + '</span>' +
                        '<span class="nav-text">' + esc(sec.t) + '</span>' +
                        '</a>';
                });
            }
        });

        html += '<div class="sb-group-title">ฝึกทำข้อสอบ</div>';
        html += navLink('#qbank', '📚', 'Question Bank', currentRoute === 'qbank', ALL_QUESTIONS.length);
        html += navLink('#flashcards', '🗂️', 'Flashcards Deck', currentRoute === 'flashcards', ALL_FLASHCARDS.length);
        html += navLink('#mock', '⏱️', 'Mock Exam', currentRoute === 'mock');
        html += navLink('#mistakes', '🔄', 'Review Mistakes', currentRoute === 'mistakes', P.mistakes.length);

        html += '<div class="sb-group-title">ติดตามผล</div>';
        html += navLink('#prog', '📈', 'Progress & สำรองข้อมูล', currentRoute === 'prog');

        $('#nav').innerHTML = html;
        closeMobileDrawer();
    }

    function navLink(href, icon, label, active, badge) {
        return (
            '<a href="' + href + '" class="nav-item ' + (active ? 'active' : '') + '">' +
            '<span class="nav-ic">' + icon + '</span>' +
            '<span class="nav-text">' + esc(label) + '</span>' +
            (badge != null ? '<span class="nav-badge">' + esc(badge) + '</span>' : '') +
            '</a>'
        );
    }

    function renderMobileTabs(currentRoute) {
        var items = [
            { href: '#home', ic: '🏠', label: 'Dashboard', on: currentRoute === 'home' },
            { href: '#a/0', ic: '📘', label: 'บทเรียน', on: /^[abcd]\//.test(currentRoute) },
            { href: '#qbank', ic: '📝', label: 'ฝึกข้อสอบ', on: currentRoute === 'qbank' || currentRoute === 'mock' },
            { href: '#mistakes', ic: '🔄', label: 'ทบทวนผิด', on: currentRoute === 'mistakes' },
            { href: '#prog', ic: '📊', label: 'Progress', on: currentRoute === 'prog' }
        ];
        $('#tabs').innerHTML = items.map(function (it) {
            return '<a href="' + it.href + '" class="' + (it.on ? 'active' : '') + '"><b>' + it.ic + '</b><span>' + it.label + '</span></a>';
        }).join('');
    }

    /* ----------------------------------------------------------------------
       Dashboard View
       ---------------------------------------------------------------------- */
    function renderDashboard() {
        $('#page-title').textContent = 'Dashboard';

        var totalTopics = FLAT_TOPICS.length || 1;
        var readTopics = FLAT_TOPICS.filter(function (t) { return !!P.v[t.k]; });
        var nextTopic = FLAT_TOPICS.filter(function (t) { return !P.v[t.k]; })[0] || FLAT_TOPICS[0];
        var nextCatIndex = nextTopic ? (nextTopic.idx + 1) : 1;
        var nextCatCode = nextTopic ? (CAT_META[nextTopic.c].short + ' · บทที่ ' + nextCatIndex) : '';

        var cd = getCountdownInfo();
        var countdownHtml = cd
            ? '<div class="countdown-num">' + (cd.days >= 0 ? cd.days : 0) + '</div>' +
            '<div class="countdown-label"><b>' + (cd.days >= 0 ? 'วัน ถึงวันสอบข้อเขียน สพฐ.' : 'ถึงกำหนดวันสอบแล้ว') + '</b><br>' + esc(cd.fullText) + '</div>'
            : '<div class="countdown-num">📅</div>' +
            '<div class="countdown-label"><b>ตั้งวันสอบเป้าหมาย สพฐ.</b><br>คลิกเพื่อกำหนดวันสอบนับถอยหลัง</div>';

        var heroSvg =
            '<svg class="hero-art" viewBox="0 0 180 180" fill="none" xmlns="http://www.w3.org/2000/svg">' +
            '<circle cx="90" cy="90" r="82" fill="#e2e8f0" fill-opacity="0.55"/>' +
            '<rect x="52" y="34" width="62" height="54" rx="6" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>' +
            '<path d="M52 54H114" stroke="#cbd5e1" stroke-width="2"/>' +
            '<path d="M72 34V88" stroke="#cbd5e1" stroke-width="2"/>' +
            '<rect x="28" y="108" width="124" height="7" rx="3.5" fill="#475569"/>' +
            '<rect x="44" y="115" width="7" height="36" rx="2" fill="#64748b"/>' +
            '<rect x="129" y="115" width="7" height="36" rx="2" fill="#64748b"/>' +
            '<path d="M56 108L66 86H94L86 108H56Z" fill="#0d9488"/>' +
            '<circle cx="118" cy="64" r="11" fill="#1e293b"/>' +
            '<path d="M104 82C104 75 110 72 118 72C126 72 132 76 132 84V112H102L104 82Z" fill="#0d9488"/>' +
            '<path d="M84 96L108 86L112 94L88 104L84 96Z" fill="#0f766e"/>' +
            '<path d="M98 112H132L126 148H116L114 122H98V112Z" fill="#1e293b"/>' +
            '<rect x="116" y="112" width="24" height="6" rx="3" fill="#334155"/>' +
            '<rect x="126" y="118" width="6" height="33" rx="2" fill="#334155"/>' +
            '</svg>';

        var catCardsHtml = D.map(function (cat) {
            var meta = CAT_META[cat.id];
            var totalSec = cat.s.length;
            var doneSec = cat.s.filter(function (_, i) { return !!P.v[cat.id + '/' + i]; }).length;
            var pctSec = Math.round((doneSec / (totalSec || 1)) * 100);

            var catQs = ALL_QUESTIONS.filter(function (q) { return q.catId === cat.id; });
            var answeredCatQs = catQs.filter(function (q) { return P.qLog[q.uid] !== undefined; });
            var correctCatQs = answeredCatQs.filter(function (q) { return P.qLog[q.uid] === true; });
            var accText = answeredCatQs.length
                ? Math.round((correctCatQs.length / answeredCatQs.length) * 100) + '%'
                : '–';

            return (
                '<a href="#' + cat.id + '/0" class="cat-card" style="--cat-color:' + meta.color + '">' +
                '<div class="cat-icon-box">' + esc(meta.icon) + '</div>' +
                '<div class="cat-title">' + esc(cat.t) + '</div>' +
                '<div class="prog-track"><div class="prog-fill" style="width:' + pctSec + '%;background:' + meta.color + '"></div></div>' +
                '<div class="cat-stats">ผ่าน ' + doneSec + '/' + totalSec + ' บท · แม่นยำ ' + accText + '</div>' +
                '</a>'
            );
        }).join('');

        var thDays = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
        var weekDotsHtml = '';
        for (var offset = 6; offset >= 0; offset--) {
            var d = new Date(Date.now() - offset * 86400000);
            var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            var isDone = !!P.activeDays[key];
            var isToday = (offset === 0);
            weekDotsHtml +=
                '<div class="day-col">' +
                '<div class="day-dot ' + (isDone ? 'done' : '') + ' ' + (isToday ? 'today' : '') + '">' + (isDone ? '✓' : '') + '</div>' +
                '<div class="day-name">' + thDays[d.getDay()] + '</div>' +
                '</div>';
        }

        var level = Math.floor((P.xp || 0) / 150) + 1;
        var xpInLevel = (P.xp || 0) % 150;
        var xpNeeded = 150 - xpInLevel;
        var xpPct = Math.round((xpInLevel / 150) * 100);

        var q1Cur = Math.min(30, P.daily.xp || 0);
        var q2Cur = Math.min(10, P.daily.answered || 0);
        var q3Cur = Math.min(1, P.daily.passed80 || 0);

        var overallPct = Math.round((readTopics.length / totalTopics) * 100);

        $('#main').innerHTML =
            '<div class="dash-layout">' +
            '  <div class="dash-main">' +
            '    <!-- 1. Hero Card -->' +
            '    <div class="card hero-card">' +
            '      ' + heroSvg +
            '      <div class="hero-body">' +
            '        <h1>วันนี้ขอแค่ 30 นาที</h1>' +
            '        <p>อ่านทีละส่วนสั้น ๆ ตอบคำถามเช็กความเข้าใจ แล้วปิดบทด้วยแบบทดสอบให้ได้ 80% ขึ้นไป</p>' +
            '        <div class="countdown-box" id="hero-countdown-btn" title="คลิกเพื่อตั้งวันสอบ">' +
            '          ' + countdownHtml +
            '        </div>' +
            '        <div class="hero-actions">' +
            '          <a href="#' + nextTopic.k + '" class="btn-primary">' + (readTopics.length ? 'เริ่มบทถัดไป' : 'เริ่มเรียนบทแรก') + '</a>' +
            '          <a href="#mock" class="btn-outline">ข้อสอบจำลอง</a>' +
            '        </div>' +
            '      </div>' +
            '    </div>' +

            '    <!-- 2. Highlight Banner -->' +
            '    <a href="#c/0" class="highlight-banner">' +
            '      <div class="hb-icon">🎯</div>' +
            '      <div class="hb-text">' +
            '        <div class="hb-title">จุดเน้นออกสอบบ่อย: พ.ร.บ.คอมพิวเตอร์ · PDPA · SQL &amp; คำนวณ Subnet</div>' +
            '        <div class="hb-sub">รวมตารางมาตราสำคัญ ตัวอย่าง Query และเครื่องคำนวณ Subnet ฝึกใช้ให้คล่องก่อนเข้าห้องสอบ</div>' +
            '      </div>' +
            '      <div style="color:var(--mu);font-weight:800">›</div>' +
            '    </a>' +

            '    <!-- 3. Next Lesson Card -->' +
            '    <div class="card continue-card">' +
            '      <div class="cont-icon">📖</div>' +
            '      <div class="cont-body">' +
            '        <div class="cont-tag">' + esc(nextTopic.catTitle) + ' · ' + esc(nextCatCode) + '</div>' +
            '        <div class="cont-title">' + esc(nextTopic.t) + '</div>' +
            '        <div class="prog-track"><div class="prog-fill" style="width:' + overallPct + '%"></div></div>' +
            '        <div class="cont-meta">ภาพรวมผ่านแล้ว ' + overallPct + '% (' + readTopics.length + '/' + totalTopics + ' บท) · ~10 นาทีต่อบท</div>' +
            '      </div>' +
            '      <a href="#' + nextTopic.k + '" class="btn-primary">เริ่มเรียน</a>' +
            '    </div>' +

            '    <!-- 4. Categories Grid -->' +
            '    <div class="section-heading">4 หมวด · สนามสอบนักวิชาการคอมพิวเตอร์ สพฐ.</div>' +
            '    <div class="cat-grid">' + catCardsHtml + '</div>' +
            '  </div>' +

            '  <!-- Right Column Widgets -->' +
            '  <div class="dash-side">' +
            '    <!-- Streak Card -->' +
            '    <div class="card">' +
            '      <div class="streak-top">' +
            '        <div class="flame-big">🔥</div>' +
            '        <div>' +
            '          <div class="streak-days">' + (P.streak || 0) + ' วัน</div>' +
            '          <div class="streak-sub">' + (P.streak > 0 ? 'เยี่ยมมาก! รักษาสถิติต่อเนื่อง' : 'เริ่มนับวันแรกวันนี้') + '</div>' +
            '        </div>' +
            '      </div>' +
            '      <div class="week-row">' + weekDotsHtml + '</div>' +
            '    </div>' +

            '    <!-- Level & XP Card -->' +
            '    <div class="card">' +
            '      <div class="level-header">' +
            '        <div class="level-title">เลเวล ' + level + '</div>' +
            '        <div class="level-xp">💎 ' + (P.xp || 0) + ' XP</div>' +
            '      </div>' +
            '      <div class="prog-track"><div class="prog-fill" style="width:' + xpPct + '%;background:var(--blue)"></div></div>' +
            '      <div class="level-sub">อีก ' + xpNeeded + ' XP ถึงเลเวล ' + (level + 1) + '</div>' +
            '    </div>' +

            '    <!-- Daily Quests Card -->' +
            '    <div class="card" id="daily-quests-card">' +
            '      <div class="quests-title">ภารกิจวันนี้</div>' +

            '      <div class="quest-item">' +
            '        <div class="quest-ic q1">⚡</div>' +
            '        <div class="quest-body">' +
            '          <div class="quest-name">เก็บ XP วันนี้ให้ได้ 30 (อ่าน + ตอบคำถาม)</div>' +
            '          <div class="quest-bar-wrap">' +
            '            <div class="quest-bar-fill" style="width:' + Math.round((q1Cur / 30) * 100) + '%"></div>' +
            '            <div class="quest-bar-text">' + q1Cur + '/30</div>' +
            '          </div>' +
            '        </div>' +
            '      </div>' +

            '      <div class="quest-item">' +
            '        <div class="quest-ic q2">🎯</div>' +
            '        <div class="quest-body">' +
            '          <div class="quest-name">ทำข้อสอบให้ได้ 10 ข้อ</div>' +
            '          <div class="quest-bar-wrap">' +
            '            <div class="quest-bar-fill" style="width:' + Math.round((q2Cur / 10) * 100) + '%"></div>' +
            '            <div class="quest-bar-text">' + q2Cur + '/10</div>' +
            '          </div>' +
            '        </div>' +
            '      </div>' +

            '      <div class="quest-item">' +
            '        <div class="quest-ic q3">🏆</div>' +
            '        <div class="quest-body">' +
            '          <div class="quest-name">ผ่านแบบทดสอบ 1 บท (≥ 80%)</div>' +
            '          <div class="quest-bar-wrap">' +
            '            <div class="quest-bar-fill" style="width:' + Math.round((q3Cur / 1) * 100) + '%"></div>' +
            '            <div class="quest-bar-text">' + q3Cur + '/1</div>' +
            '          </div>' +
            '        </div>' +
            '      </div>' +
            '    </div>' +
            '  </div>' +
            '</div>';

        $('#hero-countdown-btn').onclick = openDateModal;
    }

    /* ----------------------------------------------------------------------
       Lesson Page View
       ---------------------------------------------------------------------- */
    function renderLessonPage(catId, secIdx) {
        var cat = D.filter(function (x) { return x.id === catId; })[0];
        if (!cat || !cat.s[secIdx]) {
            renderDashboard();
            return;
        }
        var sec = cat.s[secIdx];
        var topicKey = catId + '/' + secIdx;
        var meta = CAT_META[catId] || { color: 'var(--pr)' };

        $('#page-title').textContent = sec.t;
        var mainEl = $('#main');
        mainEl.style.setProperty('--cc', meta.color);
        mainEl.innerHTML =
            '<div class="lesson-wrap" id="lesson-wrap">' +
            '  <div class="card lesson-header-card">' +
            '    <div class="mu">' + esc(cat.t) + ' · บทที่ ' + (secIdx + 1) + '/' + cat.s.length + '</div>' +
            '    <h1>' + esc(sec.t) + '</h1>' +
            '  </div>' +
            '</div>';

        var wrap = $('#lesson-wrap');
        sec.b.forEach(function (blk) {
            var card = document.createElement('div');
            card.className = 'card';
            wrap.appendChild(card);

            if (blk.k === 'h') {
                card.innerHTML = blk.v;
            } else if (blk.k === 't') {
                card.innerHTML = renderTable(blk.h, blk.r);
            } else if (blk.k === 'quiz') {
                renderQuizBlock(card, blk, topicKey);
            } else if (blk.k === 'fc') {
                renderFlashcardBlock(card, blk);
            }

            if (card.querySelector('#go')) {
                attachSubnetTool(card);
            }
            if (!card.innerHTML.trim()) {
                card.remove();
            }
        });

        // กรณีบทเรียนไม่มีแบบทดสอบ ให้แสดงปุ่มกดยืนยันว่าอ่านจบบทนี้แล้ว
        var hasQuiz = sec.b.some(function (blk) { return blk.k === 'quiz'; });
        if (!hasQuiz) {
            var isDone = !!P.v[topicKey];
            wrap.insertAdjacentHTML(
                'beforeend',
                '<div class="card" style="text-align:center">' +
                '<button type="button" id="btn-mark-done" class="' + (isDone ? 'btn-outline' : 'btn-primary') + '">' +
                (isDone ? '✅ เรียนจบบทนี้แล้ว' : '✔ บันทึกว่าอ่านจบบทนี้ (+10 XP)') +
                '</button>' +
                '</div>'
            );

            var doneBtn = $('#btn-mark-done');
            if (doneBtn) {
                doneBtn.onclick = function () {
                    if (!P.v[topicKey]) {
                        P.v[topicKey] = 1;
                        recordActivity(10, 0, 0);
                        renderSidebar(topicKey);
                        doneBtn.className = 'btn-outline';
                        doneBtn.textContent = '✅ เรียนจบบทนี้แล้ว';
                    }
                };
            }
        }

        // ปุ่มก่อนหน้า / ถัดไป
        var flatIdx = FLAT_TOPICS.findIndex(function (x) { return x.k === topicKey; });
        var prevT = flatIdx > 0 ? FLAT_TOPICS[flatIdx - 1] : null;
        var nextT = flatIdx < FLAT_TOPICS.length - 1 ? FLAT_TOPICS[flatIdx + 1] : null;

        wrap.insertAdjacentHTML(
            'beforeend',
            '<div class="pager">' +
            (prevT ? '<a href="#' + prevT.k + '"><small>◀ บทก่อนหน้า</small>' + esc(prevT.t) + '</a>' : '<span></span>') +
            (nextT ? '<a href="#' + nextT.k + '"><small>บทถัดไป ▶</small>' + esc(nextT.t) + '</a>' : '<a href="#home"><small>เรียนครบทุกบทแล้ว 🎉</small>กลับหน้า Dashboard</a>') +
            '</div>'
        );
    }

    /* ----------------------------------------------------------------------
       Question Bank / Mock Exam / Review Mistakes / Flashcards Deck
       ---------------------------------------------------------------------- */
    function renderQuizCollection(title, subtitle, questions, emptyMsg) {
        $('#page-title').textContent = title;
        var html =
            '<div class="lesson-wrap">' +
            '  <div class="card">' +
            '    <h1>' + esc(title) + '</h1>' +
            '    <p class="mu" style="margin:0">' + esc(subtitle) + '</p>' +
            '  </div>' +
            '  <div class="card" id="custom-quiz-host"></div>' +
            '</div>';

        $('#main').innerHTML = html;
        var host = $('#custom-quiz-host');

        if (!questions.length) {
            host.innerHTML = '<p style="text-align:center;padding:24px 0;color:var(--mu)">' + esc(emptyMsg) + '</p>';
            return;
        }

        renderQuizBlock(host, {
            id: 'custom_' + Date.now(),
            qs: questions.map(function (item) {
                return [
                    '[' + item.topicTitle + '] ' + item.q,
                    item.opts,
                    item.ans,
                    item.exp
                ];
            })
        }, null);
    }

    function renderQuestionBank() {
        renderQuizCollection(
            '📚 Question Bank (คลังข้อสอบทั้งหมด)',
            'รวบรวมข้อสอบทั้งหมด ' + ALL_QUESTIONS.length + ' ข้อจากทุกหมวดวิชา',
            ALL_QUESTIONS,
            'ยังไม่มีข้อสอบในคลัง'
        );
    }

    function renderMockExam() {
        var shuffled = ALL_QUESTIONS.slice().sort(function () { return Math.random() - 0.5; }).slice(0, 15);
        renderQuizCollection(
            '⏱️ Mock Exam (ข้อสอบจำลองสุ่ม 15 ข้อ)',
            'สุ่มข้อสอบคละหมวด ภาค ก · กฎหมายการศึกษา · คอมพิวเตอร์ · สัมภาษณ์ (ตั้งเป้า ≥ 80%)',
            shuffled,
            'ยังไม่มีข้อสอบสำหรับจำลอง'
        );
    }

    function renderReviewMistakes() {
        var mistakeItems = ALL_QUESTIONS.filter(function (q) {
            return P.mistakes.indexOf(q.uid) >= 0;
        });
        renderQuizCollection(
            '🔄 Review Mistakes (ทบทวนข้อที่เคยตอบผิด)',
            'มีข้อที่ต้องทบทวน ' + mistakeItems.length + ' ข้อ — เมื่อตอบถูกแล้วระบบจะนำออกจากรายการนี้อัตโนมัติ',
            mistakeItems,
            'ยอดเยี่ยม! ยังไม่มีข้อที่ตอบผิดค้างอยู่ 🎉'
        );
    }

    function renderAllFlashcards() {
        $('#page-title').textContent = 'Flashcards Deck';
        $('#main').innerHTML =
            '<div class="lesson-wrap">' +
            '  <div class="card">' +
            '    <h1>🗂️ Flashcards Deck (รวมบัตรคำทั้งหมด)</h1>' +
            '    <p class="mu" style="margin:0">รวมบัตรคำท่องจำ ' + ALL_FLASHCARDS.length + ' ใบ ทั้งกฎหมายการศึกษา พอร์ตเครือข่าย และระบบปฏิบัติการ</p>' +
            '  </div>' +
            '  <div class="card" id="all-fc-host"></div>' +
            '</div>';

        renderFlashcardBlock($('#all-fc-host'), {
            id: 'all_deck',
            c: ALL_FLASHCARDS.map(function (item) {
                return [item.front, item.back];
            })
        });
    }

    /* ----------------------------------------------------------------------
       Progress & Backup View
       ---------------------------------------------------------------------- */
    function renderProgressPage() {
        $('#page-title').textContent = 'Progress & สำรองข้อมูล';

        var totalTopics = FLAT_TOPICS.length || 1;
        var doneTopics = FLAT_TOPICS.filter(function (t) { return !!P.v[t.k]; }).length;
        var topicPct = Math.round((doneTopics / totalTopics) * 100);

        var answeredQs = Object.keys(P.qLog).length;
        var correctQs = Object.keys(P.qLog).filter(function (k) { return P.qLog[k] === true; }).length;
        var accPct = answeredQs ? Math.round((correctQs / answeredQs) * 100) : 0;

        $('#main').innerHTML =
            '<div class="lesson-wrap">' +
            '  <div class="card">' +
            '    <h1>📈 สถิติการเรียนของคุณ</h1>' +
            '    <p class="mu">บัญชีที่ใช้งานอยู่: <b>' + esc(currentUser.email) + '</b> · เลเวล ' + (Math.floor(P.xp / 150) + 1) + ' (' + P.xp + ' XP)</p>' +
            '    <p style="margin:14px 0 6px"><b>บทเรียนที่ผ่านแล้ว:</b> ' + doneTopics + ' / ' + totalTopics + ' บท (' + topicPct + '%)</p>' +
            '    <div class="prog-track"><div class="prog-fill" style="width:' + topicPct + '%"></div></div>' +
            '    <p style="margin:14px 0 6px"><b>ความแม่นยำในการทำข้อสอบ:</b> ตอบถูก ' + correctQs + ' / ' + answeredQs + ' ข้อที่เคยทำ (' + accPct + '%)</p>' +
            '    <div class="prog-track"><div class="prog-fill" style="width:' + accPct + '%;background:var(--blue)"></div></div>' +
            '  </div>' +

            '  <div class="card">' +
            '    <h3>💾 สำรอง / กู้คืนข้อมูลความก้าวหน้า (JSON)</h3>' +
            '    <p class="mu">สามารถคัดลอกข้อมูลสำรองไปเก็บไว้ หรือนำมาวางเพื่อกู้คืนความก้าวหน้าในเครื่องอื่นได้</p>' +
            '    <div class="row">' +
            '      <button type="button" class="btn-primary" id="bk-export">📋 คัดลอกข้อมูลสำรอง</button>' +
            '      <button type="button" class="btn-outline" id="bk-import">📥 นำเข้าข้อมูล</button>' +
            '      <button type="button" class="btn-outline" id="bk-reset" style="color:var(--rose)">🗑️ ล้างความก้าวหน้าทั้งหมด</button>' +
            '    </div>' +
            '    <textarea id="bk-box" rows="5" placeholder="วางโค้ด JSON สำรองข้อมูลที่นี่..." style="width:100%;margin-top:12px"></textarea>' +
            '    <div id="bk-msg" class="mu" style="margin-top:8px"></div>' +
            '  </div>' +
            '</div>';

        $('#bk-export').onclick = function () {
            var jsonStr = JSON.stringify(P);
            var box = $('#bk-box');
            box.value = jsonStr;
            box.select();
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(jsonStr).catch(function () { });
            } else {
                try { document.execCommand('copy'); } catch (e) { }
            }
            $('#bk-msg').textContent = '✅ คัดลอกข้อมูลสำรองเรียบร้อยแล้ว';
        };

        $('#bk-import').onclick = function () {
            try {
                var parsed = JSON.parse($('#bk-box').value.trim());
                P = normalizeProgress(parsed);
                save();
                applyPreferences();
                renderProgressPage();
                $('#bk-msg').textContent = '✅ นำเข้าข้อมูลสำเร็จ!';
            } catch (e) {
                $('#bk-msg').textContent = '❌ รูปแบบข้อมูล JSON ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง';
            }
        };

        $('#bk-reset').onclick = function () {
            if (confirm('ยืนยันการล้างความก้าวหน้าทั้งหมดของบัญชี ' + currentUser.email + ' ?')) {
                P = defaultProgress();
                save();
                applyPreferences();
                renderProgressPage();
            }
        };
    }

    /* ----------------------------------------------------------------------
       Router
       ---------------------------------------------------------------------- */
    function route() {
        if (!currentUser) return;
        var hash = (location.hash || '#home').replace(/^#/, '');
        if (!hash) hash = 'home';

        renderSidebar(hash);
        renderMobileTabs(hash);

        if (hash === 'home') {
            renderDashboard();
        } else if (hash === 'prog') {
            renderProgressPage();
        } else if (hash === 'qbank') {
            renderQuestionBank();
        } else if (hash === 'mock') {
            renderMockExam();
        } else if (hash === 'mistakes') {
            renderReviewMistakes();
        } else if (hash === 'flashcards') {
            renderAllFlashcards();
        } else if (hash.indexOf('/') > 0) {
            var parts = hash.split('/');
            renderLessonPage(parts[0], Number(parts[1]));
        } else {
            renderDashboard();
        }

        window.scrollTo(0, 0);
    }

    /* ----------------------------------------------------------------------
       Header Controls, Mobile Drawer & Exam Date Modal
       ---------------------------------------------------------------------- */
    function openMobileDrawer() {
        $('#sidebar').classList.add('open');
        $('#backdrop').classList.add('show');
    }

    function closeMobileDrawer() {
        $('#sidebar').classList.remove('open');
        $('#backdrop').classList.remove('show');
    }

    $('#menu').onclick = openMobileDrawer;
    $('#sb-close').onclick = closeMobileDrawer;
    $('#backdrop').onclick = closeMobileDrawer;

    $('#sq').oninput = function () {
        var q = this.value.trim().toLowerCase();
        if (!q) {
            route();
            return;
        }
        var matches = FLAT_TOPICS.filter(function (t) {
            return t.t.toLowerCase().indexOf(q) >= 0 || t.catTitle.toLowerCase().indexOf(q) >= 0;
        });
        $('#nav').innerHTML =
            '<div class="sb-group-title">ผลการค้นหา (' + matches.length + ')</div>' +
            (matches.length
                ? matches.map(function (m) {
                    return navLink('#' + m.k, '📄', m.t, false);
                }).join('')
                : '<div class="mu" style="padding:10px">ไม่พบหัวข้อที่ค้นหา</div>');
    };

    $('#fa').onclick = function () {
        P.fs = Math.max(13, (P.fs || 16) - 1);
        applyPreferences();
        save();
    };

    $('#fb').onclick = function () {
        P.fs = Math.min(24, (P.fs || 16) + 1);
        applyPreferences();
        save();
    };

    $('#th').onclick = function () {
        var isDark = document.documentElement.dataset.theme === 'dark' ||
            (!document.documentElement.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
        P.theme = isDark ? 'light' : 'dark';
        applyPreferences();
        save();
    };

    $('#hdr-check').onclick = function () {
        if (location.hash !== '#home') {
            location.hash = '#home';
        }
        setTimeout(function () {
            var el = $('#daily-quests-card');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 60);
    };

    // User Account Dropdown
    $('#user-menu-btn').onclick = function (e) {
        e.stopPropagation();
        var dd = $('#user-dropdown');
        dd.hidden = !dd.hidden;
    };

    document.addEventListener('click', function (e) {
        var wrap = $('.user-menu-wrap');
        if (wrap && !wrap.contains(e.target)) {
            $('#user-dropdown').hidden = true;
        }
    });

    $('#ud-switch').onclick = function () {
        openAuthScreen();
    };

    $('#ud-logout').onclick = function () {
        try { localStorage.removeItem(SESSION_KEY); } catch (e) { }
        currentUser = null;
        openAuthScreen();
    };

    // Exam Date Modal
    function openDateModal() {
        $('#user-dropdown').hidden = true;
        $('#exam-date-input').value = (P && P.examDate) ? P.examDate : '';
        $('#date-modal').hidden = false;
    }

    $('#exam-card-btn').onclick = openDateModal;
    $('#ud-exam-date').onclick = openDateModal;

    $('#date-cancel-btn').onclick = function () {
        $('#date-modal').hidden = true;
    };

    $('#date-clear-btn').onclick = function () {
        P.examDate = '';
        save();
        updateCountdownSidebar();
        $('#date-modal').hidden = true;
        if ((location.hash || '#home') === '#home') renderDashboard();
    };

    $('#date-save-btn').onclick = function () {
        P.examDate = $('#exam-date-input').value;
        save();
        updateCountdownSidebar();
        $('#date-modal').hidden = true;
        if ((location.hash || '#home') === '#home') renderDashboard();
    };

    /* ----------------------------------------------------------------------
       Bootstrap Application
       ---------------------------------------------------------------------- */
    window.addEventListener('hashchange', route);

    (function init() {
        var session = store.get(SESSION_KEY, null);
        var users = store.get(USERS_KEY, {});
        if (session && session.email && users[session.email]) {
            loadUserSession(users[session.email]);
        } else {
            openAuthScreen();
        }
    })();
})();