// ==UserScript==
// @name         Instagram Unfollow Tracker
// @namespace    oryvo.igtracker
// @version      2.2
// @description  Tracks unfollowers via live GraphQL hash capture + API. Works from any page.
// @author       Sathvik Sridar (github.com/User319183) — built with Oryvo (oryvo.ai) by Covalence Systems Inc.
// @match        https://www.instagram.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";
  if (window.__igt_loaded) return;
  window.__igt_loaded = true;

  var sleep = function(ms) { return new Promise(function(r) { setTimeout(r, ms); }); };
  var LS_KEY = "igt_v3_data";
  var HASH_KEY = "igt_v3_hashes";
  var COOLDOWN_MS = 10 * 60 * 1000;

  // Known fallback hashes (stable for years, but may rotate)
  var FALLBACK = {
    following: "d04b0a864b4b54837c0d870b0e77e076",
    followers: "c76146de99bb02f6415203be841dd25a"
  };

  // -- storage --
  function loadData() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (_) { return {}; }
  }
  function saveData(obj) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch (_) {}
  }
  function loadHashes() {
    try { return JSON.parse(localStorage.getItem(HASH_KEY)) || {}; } catch (_) { return {}; }
  }
  function saveHashes(obj) {
    try { localStorage.setItem(HASH_KEY, JSON.stringify(obj)); } catch (_) {}
  }

  var HASHES = loadHashes();

  // -- cookies --
  function getCookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()\[\]\\\/+^])/g, "\\$1") + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }

  // ================================================================
  //  LIVE HASH CAPTURE — intercept Instagram's own GraphQL requests
  // ================================================================
  var _origFetch = window.fetch;
  window.fetch = function() {
    var args = Array.prototype.slice.call(arguments);
    var prom = _origFetch.apply(this, args);
    var url = args[0];
    if (typeof url === "string" && url.indexOf("graphql/query") !== -1) {
      prom.then(function(resp) {
        var clone = resp.clone();
        clone.json().then(function(data) {
          var hash = null;
          try { hash = new URL(url).searchParams.get("query_hash"); } catch (_) {}
          if (!hash) return;
          var ud = ((data || {}).data || {}).user || {};
          if (ud.edge_follow) {
            HASHES.following = hash;
            saveHashes(HASHES);
          }
          if (ud.edge_followed_by) {
            HASHES.followers = hash;
            saveHashes(HASHES);
          }
        }).catch(function(){});
        return resp;
      }).catch(function(){});
    }
    return prom;
  };

  // ================================================================
  //  UI STYLES
  // ================================================================
  var css = [
    "#igt-float{position:fixed;bottom:24px;right:24px;width:48px;height:48px;border-radius:50%;",
    "background:linear-gradient(135deg,#667eea,#764ba2);box-shadow:0 4px 24px rgba(102,126,234,.45);",
    "z-index:2147483646;cursor:pointer;display:flex;align-items:center;justify-content:center;",
    "transition:transform .25s cubic-bezier(.34,1.56,.64,1),box-shadow .25s;user-select:none;}",
    "#igt-float:hover{transform:scale(1.12);box-shadow:0 6px 32px rgba(102,126,234,.6);}",
    "#igt-float svg{width:22px;height:22px;fill:#fff;}",
    "#igt-badge{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;background:#ff3b30;",
    "border-radius:9px;color:#fff;font-size:10px;font-weight:700;display:none;align-items:center;",
    "justify-content:center;padding:0 5px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}",
    "#igt-panel{position:fixed;bottom:88px;right:24px;width:400px;max-height:560px;",
    "background:rgba(255,255,255,.94);backdrop-filter:blur(20px) saturate(180%);",
    "-webkit-backdrop-filter:blur(20px) saturate(180%);border:1px solid rgba(0,0,0,.08);",
    "border-radius:20px;box-shadow:0 16px 64px rgba(0,0,0,.18),0 2px 8px rgba(0,0,0,.06);",
    "z-index:2147483647;overflow:hidden;display:none;flex-direction:column;",
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;",
    "font-size:13px;color:#1c1c1e;animation:igt-slide .35s cubic-bezier(.34,1.56,.64,1);user-select:none;}",
    "@keyframes igt-slide{from{opacity:0;transform:translateY(20px) scale(.94);}",
    "to{opacity:1;transform:translateY(0) scale(1);}}",
    "#igt-panel-header{display:flex;align-items:center;justify-content:space-between;",
    "padding:16px 18px 12px;border-bottom:1px solid rgba(0,0,0,.06);}",
    "#igt-panel-header h2{font-size:16px;font-weight:700;margin:0;letter-spacing:-.2px;color:#1c1c1e;}",
    "#igt-panel-close{background:none;border:none;font-size:20px;cursor:pointer;color:#8e8e93;padding:0;line-height:1;}",
    "#igt-panel-close:hover{color:#1c1c1e;}",
    "#igt-tabs{display:flex;gap:0;padding:0 18px;border-bottom:1px solid rgba(0,0,0,.06);}",
    "#igt-tabs button{background:none;border:none;padding:10px 16px;font-size:13px;font-weight:600;",
    "color:#8e8e93;cursor:pointer;border-bottom:2px solid transparent;transition:color .2s,border-color .2s;}",
    "#igt-tabs button:hover{color:#1c1c1e;}",
    "#igt-tabs button.active{color:#667eea;border-bottom-color:#667eea;}",
    "#igt-panel-body{overflow-y:auto;flex:1;padding:14px 18px;}",
    ".igt-stat-row{display:flex;gap:12px;margin-bottom:14px;}",
    ".igt-stat{flex:1;background:linear-gradient(135deg,rgba(102,126,234,.08),rgba(118,75,162,.08));",
    "border-radius:14px;padding:14px;text-align:center;}",
    ".igt-stat-val{font-size:28px;font-weight:800;letter-spacing:-.5px;color:#1c1c1e;}",
    ".igt-stat-lbl{font-size:11px;color:#8e8e93;margin-top:2px;text-transform:uppercase;letter-spacing:.5px;font-weight:600;}",
    ".igt-section-title{font-size:12px;font-weight:700;color:#8e8e93;text-transform:uppercase;letter-spacing:.5px;margin:12px 0 8px;}",
    ".igt-user-row{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;",
    "border-radius:10px;transition:background .15s;}",
    ".igt-user-row:hover{background:rgba(0,0,0,.04);}",
    ".igt-user-row a{color:#1c1c1e;text-decoration:none;font-weight:500;font-size:13px;}",
    ".igt-user-row a:hover{color:#667eea;}",
    ".igt-user-tag{font-size:11px;color:#ff3b30;font-weight:600;background:rgba(255,59,48,.1);padding:2px 8px;border-radius:6px;}",
    ".igt-scan-status{font-size:12px;color:#8e8e93;text-align:center;padding:8px 0;margin-bottom:6px;}",
    ".igt-scan-progress{height:4px;background:#efefef;border-radius:2px;margin-bottom:12px;overflow:hidden;}",
    ".igt-scan-progress-bar{height:100%;width:0%;background:linear-gradient(90deg,#667eea,#764ba2);border-radius:2px;transition:width .3s;}",
    "#igt-scan-btn{width:100%;padding:12px;border:none;border-radius:12px;",
    "background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;font-weight:700;font-size:14px;",
    "cursor:pointer;transition:opacity .2s,transform .15s;}",
    "#igt-scan-btn:hover{opacity:.92;transform:scale(1.01);}",
    "#igt-scan-btn:disabled{opacity:.5;transform:none;cursor:default;}",
    ".igt-empty{text-align:center;color:#8e8e93;padding:24px 0;font-size:13px;}",
    ".igt-toast{position:fixed;top:20px;right:24px;z-index:2147483647;",
    "background:rgba(28,28,30,.92);backdrop-filter:blur(12px);color:#fff;padding:12px 18px;",
    "border-radius:14px;font-size:13px;font-weight:600;box-shadow:0 8px 32px rgba(0,0,0,.24);",
    "animation:igt-slide .4s ease;max-width:360px;}"
  ].join("\n");

  var domReady = new Promise(function(resolve) {
    if (document.readyState === "complete" || document.readyState === "interactive") {
      resolve();
    } else {
      document.addEventListener("DOMContentLoaded", resolve);
    }
  });

  domReady.then(function() {
    var styleEl = document.createElement("style");
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    var floatBtn = document.createElement("div");
    floatBtn.id = "igt-float";
    floatBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>';
    var badge = document.createElement("div");
    badge.id = "igt-badge";
    floatBtn.appendChild(badge);
    document.body.appendChild(floatBtn);

    var panel = document.createElement("div");
    panel.id = "igt-panel";
    panel.innerHTML = '<div id="igt-panel-header"><h2>Unfollow Tracker</h2><button id="igt-panel-close">&times;</button></div><div id="igt-tabs"><button data-tab="overview" class="active">Overview</button><button data-tab="unfollowers">Unfollowers</button><button data-tab="log">Activity</button></div><div id="igt-panel-body"></div>';
    document.body.appendChild(panel);

    var $body = document.getElementById("igt-panel-body");

    function toast(msg) {
      var t = document.createElement("div");
      t.className = "igt-toast";
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(function() { t.style.opacity = "0"; t.style.transition = "opacity .3s"; setTimeout(function() { t.remove(); }, 400); }, 3500);
    }

    // ================================================================
    //  GRAPHQL API with live hashes
    // ================================================================
    var APP_ID = "936619743392459";

    async function graphqlFetch(queryHash, userId, after) {
      var variables = { id: userId, include_reel: false, fetch_mutual: false, first: 50 };
      if (after) variables.after = after;
      var url = "https://www.instagram.com/graphql/query/?query_hash=" + queryHash + "&variables=" + encodeURIComponent(JSON.stringify(variables));
      var csrf = getCookie("csrftoken") || "";

      var resp = await fetch(url, {
        credentials: "include",
        headers: { "X-IG-App-ID": APP_ID, "X-CSRFToken": csrf, "X-Requested-With": "XMLHttpRequest", "Accept": "*/*" }
      });
      if (!resp.ok) {
        if (resp.status === 429) throw new Error("Rate limited. Wait a few minutes.");
        throw new Error("API status " + resp.status);
      }
      return await resp.json();
    }

    async function fetchAllGraphQL(queryHash, userId, label) {
      var all = [];
      var seen = {};
      var after = null;
      var page = 0;
      var MAX_PAGES = 50;

      while (page < MAX_PAGES) {
        page++;
        var data;
        try {
          data = await graphqlFetch(queryHash, userId, after);
        } catch (e) {
          if (e.message && e.message.indexOf("API status") !== -1) {
            // Hash might be invalid — pause and retry once
            await sleep(3000);
            data = await graphqlFetch(queryHash, userId, after);
          } else {
            throw e;
          }
        }

        var ud = ((data || {}).data || {}).user || {};
        var edges = ud.edge_follow || ud.edge_followed_by || {};
        var list = edges.edges || [];

        for (var i = 0; i < list.length; i++) {
          var username = list[i].node.username;
          if (username && !seen[username]) { seen[username] = true; all.push(username); }
        }

        var pageInfo = edges.page_info || {};
        if (!pageInfo.has_next_page || list.length === 0) break;
        after = pageInfo.end_cursor;

        await sleep(800 + Math.random() * 600);
      }
      return all;
    }

    // ================================================================
    //  DIALOG HASH REFRESH — brief flash to capture current hashes
    // ================================================================
    function findBtn(type) {
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
      var node;
      while ((node = walker.nextNode())) {
        var text = node.textContent.trim().toLowerCase();
        if (text === type || text.endsWith(" " + type)) {
          var p = node.parentElement;
          while (p && p !== document.body) {
            if (["A","BUTTON"].indexOf(p.tagName) !== -1 || ["link","button"].indexOf(p.getAttribute("role")||"") !== -1) {
              if (p.offsetParent) return p;
            }
            p = p.parentElement;
          }
        }
      }
      var links = document.querySelectorAll('a[href*="/' + type + '/"]');
      for (var i = 0; i < links.length; i++) {
        if (links[i].offsetParent && !links[i].closest("nav")) return links[i];
      }
      return null;
    }

    async function refreshHashViaDialog(type) {
      var btn = findBtn(type);
      if (!btn) throw new Error("Cannot find " + type + " link. Visit your profile first.");
      btn.click();
      await sleep(3000);

      var dialog = document.querySelector('div[role="dialog"]');
      if (!dialog) {
        var ls = document.querySelectorAll('div[style*="position"], div[style*="fixed"]');
        for (var i = 0; i < ls.length; i++) {
          if (ls[i].querySelector('a[href^="/"]') && ls[i].offsetHeight > 300) { dialog = ls[i]; break; }
        }
      }
      if (dialog) {
        var cb = dialog.querySelector('svg[aria-label="Close"],[aria-label="Close"]');
        if (cb) (cb.closest("button") || cb.closest('[role="button"]') || cb).click();
        else document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
      }
      await sleep(1200);
    }

    async function ensureHashes() {
      var needRefresh = false;
      if (!HASHES.following) { HASHES.following = FALLBACK.following; needRefresh = true; }
      if (!HASHES.followers) { HASHES.followers = FALLBACK.followers; needRefresh = true; }

      // Test the following hash with a single-page request
      try {
        var userId = getCookie("ds_user_id");
        if (!userId) throw new Error("Not logged in");
        var test = await graphqlFetch(HASHES.following, userId, null);
        var ud = ((test || {}).data || {}).user || {};
        if (!ud.edge_follow) needRefresh = true;
      } catch (e) {
        needRefresh = true;
      }

      if (needRefresh) {
        toast("Refreshing API hashes... one moment");
        await refreshHashViaDialog("following");
        await sleep(1500);
        await refreshHashViaDialog("followers");
        await sleep(1500);

        // Check if we captured anything
        var fresh = loadHashes();
        if (fresh.following) HASHES.following = fresh.following;
        if (fresh.followers) HASHES.followers = fresh.followers;

        // If still missing, fall back to hardcoded
        if (!HASHES.following) HASHES.following = FALLBACK.following;
        if (!HASHES.followers) HASHES.followers = FALLBACK.followers;
        saveHashes(HASHES);
      }
    }

    // ================================================================
    //  SCAN
    // ================================================================
    async function runScan() {
      var userId = getCookie("ds_user_id");
      if (!userId) throw new Error("Not logged in to Instagram.");

      await ensureHashes();

      var following = await fetchAllGraphQL(HASHES.following || FALLBACK.following, userId, "Following");
      var followers = await fetchAllGraphQL(HASHES.followers || FALLBACK.followers, userId, "Followers");

      var old = loadData();
      var oldFollowers = old.followers || [];
      var oldNotFB = (old.following || []).filter(function(u) { return (old.followers || []).indexOf(u) === -1; });
      var unfollowedMe = oldFollowers.filter(function(u) { return followers.indexOf(u) === -1; });
      var log = old.log || [];

      for (var i = 0; i < unfollowedMe.length; i++) {
        if (old.scannedAt) {
          log.push({ msg: "@" + unfollowedMe[i] + " unfollowed you", at: Date.now() });
          toast("@" + unfollowedMe[i] + " unfollowed you");
        }
      }

      var data = { following: following, followers: followers, priorNotFB: oldNotFB, scannedAt: Date.now(), log: log };
      saveData(data);

      var notFB = following.filter(function(u) { return followers.indexOf(u) === -1; });
      var newUF = notFB.filter(function(u) { return oldNotFB.indexOf(u) === -1; });
      if (newUF.length) {
        badge.textContent = newUF.length;
        badge.style.display = "flex";
      }
      return data;
    }

    // ================================================================
    //  RENDER
    // ================================================================
    function render(data, tab) {
      var following = data.following || [];
      var followers = data.followers || [];
      var notFB = following.filter(function(u) { return followers.indexOf(u) === -1; });
      var priorNotFB = data.priorNotFB || [];
      var newlyUnfollowed = notFB.filter(function(u) { return priorNotFB.indexOf(u) === -1; });
      var log = data.log || [];

      var html = "";
      if (tab === "overview") {
        html += '<div class="igt-stat-row">';
        html += '<div class="igt-stat"><div class="igt-stat-val">' + following.length + '</div><div class="igt-stat-lbl">Following</div></div>';
        html += '<div class="igt-stat"><div class="igt-stat-val">' + followers.length + '</div><div class="igt-stat-lbl">Followers</div></div>';
        html += '<div class="igt-stat"><div class="igt-stat-val">' + notFB.length + '</div><div class="igt-stat-lbl">Not Back</div></div>';
        html += '</div>';
        html += '<div style="font-size:11px;color:#8e8e93;text-align:center;margin-bottom:10px;">Last scan: ' + (data.scannedAt ? new Date(data.scannedAt).toLocaleString() : "never") + '</div>';
        if (newlyUnfollowed.length) {
          html += '<div class="igt-section-title">New Unfollowers</div>';
          for (var n = 0; n < newlyUnfollowed.length; n++) {
            html += '<div class="igt-user-row"><a href="https://instagram.com/' + newlyUnfollowed[n] + '" target="_blank">@' + newlyUnfollowed[n] + '</a><span class="igt-user-tag">NEW</span></div>';
          }
        }
        html += '<div class="igt-scan-status" id="igt-scan-status"></div>';
        html += '<div class="igt-scan-progress" id="igt-scan-progress" style="display:none"><div class="igt-scan-progress-bar" id="igt-scan-bar"></div></div>';
        html += '<button id="igt-scan-btn">Scan Now</button>';
      } else if (tab === "unfollowers") {
        if (notFB.length) {
          html += '<div class="igt-section-title">Don\'t Follow Back (' + notFB.length + ')</div>';
          for (var j = 0; j < notFB.length; j++) {
            var isNew = newlyUnfollowed.indexOf(notFB[j]) >= 0;
            html += '<div class="igt-user-row"><a href="https://instagram.com/' + notFB[j] + '" target="_blank">@' + notFB[j] + '</a>' + (isNew ? '<span class="igt-user-tag">NEW</span>' : '') + '</div>';
          }
        } else {
          html += '<div class="igt-empty">Everyone follows you back</div>';
        }
      } else if (tab === "log") {
        if (log.length) {
          html += '<div class="igt-section-title">Recent Activity</div>';
          var reversed = log.slice().reverse();
          for (var k = 0; k < reversed.length && k < 30; k++) {
            html += '<div class="igt-user-row"><span>' + reversed[k].msg + '</span><span style="font-size:10px;color:#8e8e93;">' + new Date(reversed[k].at).toLocaleString() + '</span></div>';
          }
        } else {
          html += '<div class="igt-empty">No activity yet</div>';
        }
      }
      $body.innerHTML = html;

      var sb = $body.querySelector("#igt-scan-btn");
      if (sb) {
        sb.onclick = async function() {
          sb.disabled = true;
          sb.textContent = "Scanning...";

          var statusEl = document.getElementById("igt-scan-status");
          var progressEl = document.getElementById("igt-scan-progress");
          var barEl = document.getElementById("igt-scan-bar");
          if (progressEl) progressEl.style.display = "block";
          if (statusEl) statusEl.textContent = "Preparing...";

          var progress = 0;
          var tick = setInterval(function() {
            progress = Math.min(95, progress + 2);
            if (barEl) barEl.style.width = progress + "%";
          }, 500);

          try {
            var newData = await runScan();
            clearInterval(tick);
            if (progressEl) progressEl.style.display = "none";
            if (statusEl) statusEl.textContent = "";
            sb.textContent = "Scan Now";
            sb.disabled = false;
            var activeTab = document.querySelector("#igt-tabs button.active");
            render(newData, activeTab ? activeTab.dataset.tab : "overview");
            toast("Done: " + newData.following.length + " following, " + newData.followers.length + " followers");
          } catch (err) {
            clearInterval(tick);
            if (progressEl) progressEl.style.display = "none";
            if (statusEl) statusEl.textContent = "";
            sb.disabled = false;
            sb.textContent = "Scan Now";
            toast("Error: " + err.message);
          }
        };
      }

      document.querySelectorAll("#igt-tabs button").forEach(function(b) {
        b.onclick = function() {
          document.querySelectorAll("#igt-tabs button").forEach(function(bb) { bb.classList.remove("active"); });
          b.classList.add("active");
          render(data, b.dataset.tab);
        };
      });
    }

    // -- toggle --
    floatBtn.onclick = function() {
      var vis = panel.style.display === "flex";
      panel.style.display = vis ? "none" : "flex";
      if (!vis) render(loadData(), "overview");
    };
    document.getElementById("igt-panel-close").onclick = function() { panel.style.display = "none"; };

    // -- auto-scan --
    async function maybeAutoScan() {
      var oldData = loadData();
      if (oldData.scannedAt && Date.now() - oldData.scannedAt < COOLDOWN_MS) return;
      try {
        var newData = await runScan();
        var notFB = (newData.following || []).filter(function(u) { return (newData.followers || []).indexOf(u) === -1; });
        var oldNotFB = (oldData.following || []).filter(function(u) { return (oldData.followers || []).indexOf(u) === -1; });
        var newUF = notFB.filter(function(u) { return oldNotFB.indexOf(u) === -1; });
        if (newUF.length) {
          badge.textContent = newUF.length;
          badge.style.display = "flex";
        }
      } catch (_) {}
    }

    // -- init --
    var initial = loadData();
    if (initial.following && initial.followers) {
      var initNotFB = initial.following.filter(function(u) { return initial.followers.indexOf(u) === -1; });
      var initNewUF = initNotFB.filter(function(u) { return (initial.priorNotFB || []).indexOf(u) === -1; });
      if (initNewUF.length) { badge.textContent = initNewUF.length; badge.style.display = "flex"; }
    }

    setTimeout(function() {
      var data = loadData();
      if (!data.scannedAt || Date.now() - data.scannedAt > COOLDOWN_MS) {
        maybeAutoScan();
      }
    }, 5000);

    setInterval(maybeAutoScan, 15 * 60 * 1000);
  });
})();
