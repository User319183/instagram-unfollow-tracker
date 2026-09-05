// ==UserScript==
// @name         Instagram Unfollow Tracker
// @namespace    oryvo.igtracker
// @version      1.1
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
  var RECENT_KEY = "igt_v3_recent";
  var COOLDOWN_MS = 10 * 60 * 1000;

  var FALLBACK = {
    following: "d04b0a864b4b54837c0d870b0e77e076",
    followers: "c76146de99bb02f6415203be841dd25a"
  };

  var currentTarget = { id: null, username: null };
  var hashMessageShown = false;

  function loadData(userId) {
    var key = LS_KEY + "_" + (userId || getCookie("ds_user_id") || "unknown");
    try { return JSON.parse(sessionStorage.getItem(key)) || {}; } catch (_) { return {}; }
  }
  function saveData(userId, obj) {
    var key = LS_KEY + "_" + (userId || getCookie("ds_user_id") || "unknown");
    try { sessionStorage.setItem(key, JSON.stringify(obj)); } catch (_) {}
  }
  function loadHashes() {
    try { return JSON.parse(sessionStorage.getItem(HASH_KEY)) || {}; } catch (_) { return {}; }
  }
  function saveHashes(obj) {
    try { sessionStorage.setItem(HASH_KEY, JSON.stringify(obj)); } catch (_) {}
  }
  function loadRecent() {
    try { return JSON.parse(sessionStorage.getItem(RECENT_KEY)) || []; } catch (_) { return []; }
  }
  function saveRecent(list) {
    try { sessionStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 10))); } catch (_) {}
  }
  function addRecent(username, id) {
    var list = loadRecent();
    list = list.filter(function(r) { return r.username !== username; });
    list.unshift({ username: username, id: id, at: Date.now() });
    saveRecent(list);
  }

  function getCookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()\[\]\\\/+^])/g, "\\$1") + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function getHeaders() {
    var h = {
      "Accept": "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "X-IG-App-ID": "936619743392459",
      "X-Requested-With": "XMLHttpRequest",
      "X-CSRFToken": getCookie("csrftoken") || "",
      "X-ASBD-ID": "129477",
      "Referer": "https://www.instagram.com/",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin"
    };
    var claim = sessionStorage.getItem("igt_www_claim") || localStorage.getItem("x_ig_www_claim") || localStorage.getItem("www_claim");
    if (!claim) {
      try {
        var sd = window._sharedData;
        if (sd && sd.config && sd.config.www_claim) claim = sd.config.www_claim;
      } catch (e) {}
    }
    if (!claim) {
      try {
        var id = window.__initialData;
        if (id && id.config && id.config.www_claim) claim = id.config.www_claim;
      } catch (e) {}
    }
    if (!claim) {
      var scripts = document.querySelectorAll("script:not([src])");
      for (var i = 0; i < scripts.length; i++) {
        var text = scripts[i].textContent || "";
        var m = text.match(/"www_claim":"([^"]+)"/);
        if (m) { claim = m[1]; break; }
        m = text.match(/"x_ig_www_claim":"([^"]+)"/);
        if (m) { claim = m[1]; break; }
      }
    }
    if (claim) h["X-IG-WWW-Claim"] = claim;
    return h;
  }

  var HASHES = loadHashes();

  var _origFetch = window.fetch;
  window.fetch = function() {
    var args = Array.prototype.slice.call(arguments);
    var url = args[0];
    var opts = args[1] || {};
    if (opts.headers) {
      var h = opts.headers;
      if (typeof h.get === "function") {
        var claim = h.get("X-IG-WWW-Claim") || h.get("x-ig-www-claim");
        if (claim) try { sessionStorage.setItem("igt_www_claim", claim); } catch (_) {}
      } else if (typeof h === "object") {
        for (var key in h) {
          if (key.toLowerCase() === "x-ig-www-claim") {
            try { sessionStorage.setItem("igt_www_claim", h[key]); } catch (_) {}
          }
        }
      }
    }
    if (typeof url === "string" && url.indexOf("graphql/query") !== -1) {
      var prom = _origFetch.apply(this, args);
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
      return prom;
    }
    return _origFetch.apply(this, args);
  };

  async function graphqlFetch(hash, userId, after) {
    var url = "https://www.instagram.com/graphql/query/?query_hash=" + encodeURIComponent(hash)
      + "&variables=" + encodeURIComponent(JSON.stringify({ id: userId, first: 50, after: after }));
    var resp = await fetch(url, {
      method: "GET",
      headers: getHeaders(),
      credentials: "include"
    });
    if (resp.status === 429) {
      throw new Error("Rate limited by Instagram. Wait a few minutes.");
    }
    if (!resp.ok) {
      throw new Error("Instagram API error: " + resp.status);
    }
    return resp.json();
  }

  async function jitteredSleep(baseMs) {
    var jitter = Math.floor(Math.random() * baseMs * 0.5);
    await sleep(baseMs + jitter);
  }

  async function fetchAllGraphQL(hash, userId, label) {
    var all = [];
    var after = null;
    var hasNext = true;
    var page = 0;
    while (hasNext) {
      var data = await graphqlFetch(hash, userId, after);
      var user = ((data || {}).data || {}).user || {};
      var edge = user.edge_follow || user.edge_followed_by || {};
      var nodes = (edge.edges || []).map(function(e) { return e.node.username; });
      all = all.concat(nodes);
      hasNext = edge.page_info ? edge.page_info.has_next_page : false;
      after = edge.page_info ? edge.page_info.end_cursor : null;
      page++;
      if (hasNext) {
        var baseDelay = page <= 3 ? 800 : 1500;
        await jitteredSleep(baseDelay);
      }
    }
    return all;
  }

  async function searchUserFallback(username) {
    var url = "https://www.instagram.com/api/v1/web/search/topsearch/?query=" + encodeURIComponent(username) + "&count=1";
    var resp = await fetch(url, {
      method: "GET",
      headers: getHeaders(),
      credentials: "include"
    });
    if (!resp.ok) throw new Error("Search API error: " + resp.status);
    var json = await resp.json();
    var users = (json.users || []);
    for (var i = 0; i < users.length; i++) {
      var u = (users[i].user || users[i]);
      if ((u.username || "").toLowerCase() === username.toLowerCase()) {
        return {
          id: String(u.pk || u.id),
          username: u.username,
          isPrivate: !!u.is_private,
          isFollowedByViewer: false
        };
      }
    }
    throw new Error("User not found in search results.");
  }

  async function scrapeProfilePage(username) {
    function extractJSONFromCall(html, funcName) {
      var idx = html.indexOf(funcName);
      if (idx === -1) return null;
      var parenIdx = html.indexOf('(', idx);
      if (parenIdx === -1) return null;
      var commaIdx = html.indexOf(',', parenIdx);
      if (commaIdx === -1) return null;
      var start = commaIdx + 1;
      while (start < html.length && /\s/.test(html[start])) start++;
      var depth = 0;
      var inString = false;
      var stringChar = null;
      var end = -1;
      for (var i = start; i < html.length; i++) {
        var ch = html[i];
        if (inString) {
          if (ch === '\\') { i++; continue; }
          if (ch === stringChar) inString = false;
          continue;
        }
        if (ch === '"' || ch === "'") {
          inString = true;
          stringChar = ch;
          continue;
        }
        if (ch === '{' || ch === '[') depth++;
        if (ch === '}' || ch === ']') {
          depth--;
          if (depth === 0) {
            end = i + 1;
            break;
          }
        }
      }
      if (end === -1) return null;
      try {
        return JSON.parse(html.substring(start, end));
      } catch (e) {
        return null;
      }
    }

    var url = "https://www.instagram.com/" + username + "/";
    var resp = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.instagram.com/",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin"
      },
      credentials: "include"
    });
    if (resp.status === 404) throw new Error("User @" + username + " not found.");
    if (!resp.ok) throw new Error("Could not load profile page (" + resp.status + ")");
    var html = await resp.text();

    var userData = null;
    var uname = username.toLowerCase();

    // Modern Instagram: window.__additionalDataLoaded('/username', {...})
    var addData = extractJSONFromCall(html, 'window.__additionalDataLoaded');
    if (addData) {
      var user = ((((addData || {}).graphql || {}).user) || (((addData || {}).raw || {}).user));
      if (user && user.id && (user.username || "").toLowerCase() === uname) userData = user;
    }

    // Legacy _sharedData
    if (!userData) {
      var m1 = html.match(/window\._sharedData\s*=\s*({.+?});<\/script>/);
      if (m1) {
        try {
          var sd = JSON.parse(m1[1]);
          var user = (((((sd || {}).entry_data || {}).ProfilePage || [])[0] || {}).graphql || {}).user;
          if (user) userData = user;
        } catch (e) {}
      }
    }

    // Legacy __initialDataLoaded
    if (!userData) {
      var initData = extractJSONFromCall(html, 'window.__initialDataLoaded');
      if (initData) {
        var user = (((initData || {}).root || {}).graphql || {}).user;
        if (user) userData = user;
      }
    }

    // application/ld+json structured data
    if (!userData) {
      var ldScripts = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/gs) || [];
      for (var i = 0; i < ldScripts.length; i++) {
        try {
          var ld = JSON.parse(ldScripts[i].replace(/<script type="application\/ld\+json">|<\/script>/g, ""));
          if (ld && ld.mainEntityofPage) {
            var ent = ld.mainEntityofPage;
            if (ent.identifier) {
              if ((ent.name || "").toLowerCase() === uname || (ent.identifier.name || "").toLowerCase() === uname) {
                userData = { id: String(ent.identifier.value || ent.identifier), username: username };
                break;
              }
            }
          }
        } catch (e) {}
      }
    }

    // Aggressive script scan for user object
    if (!userData) {
      var scripts = html.match(/<script[^>]*>.*?<\/script>/gs) || [];
      for (var i = 0; i < scripts.length; i++) {
        var s = scripts[i].replace(/<script[^>]*>|<\/script>/g, "");
        if (s.indexOf('"username":"' + username + '"') !== -1 || s.indexOf('"username": "' + username + '"') !== -1 || s.indexOf('"username":"' + uname + '"') !== -1 || s.indexOf('"username": "' + uname + '"') !== -1) {
          var uMatch = s.match(/"user":\s*({(?:[^{}]|{[^{}]*})*})/);
          if (uMatch) {
            try {
              var u = JSON.parse(uMatch[1]);
              if (u.id) { userData = u; break; }
            } catch (e) {}
          }
          var rawMatch = s.match(new RegExp('"id":\s*"(\d+)"[^}]*"username":\s*"' + username.replace(/\./g, '\\\\.') + '"'));
          if (rawMatch) {
            userData = { id: rawMatch[1], username: username };
            break;
          }
        }
      }
    }

    // Global HTML scan for id near username
    if (!userData) {
      var globalMatch = html.match(new RegExp('"id":\s*"(\d+)"[^}]*"username":\s*"' + username.replace(/\./g, '\\\\.') + '"'));
      if (globalMatch) {
        userData = { id: globalMatch[1], username: username };
      }
    }

    if (!userData || !userData.id) {
      throw new Error("Could not extract user data from profile page.");
    }

    return {
      id: String(userData.id),
      username: userData.username || username,
      isPrivate: !!userData.is_private,
      isFollowedByViewer: !!userData.followed_by_viewer
    };
  }


  async function resolveUsername(username) {
    if (!username || username.trim() === "") {
      var selfId = getCookie("ds_user_id");
      if (!selfId) throw new Error("Not logged in to Instagram.");
      return { id: selfId, username: "Your Account", isPrivate: false, isFollowedByViewer: true };
    }
    username = username.trim().toLowerCase().replace(/^@/, "");
    var url = "https://www.instagram.com/api/v1/users/web_profile_info/?username=" + encodeURIComponent(username);
    var resp = await fetch(url, {
      method: "GET",
      headers: getHeaders(),
      credentials: "include"
    });
    if (resp.status === 404) throw new Error("User @" + username + " not found.");
    if (resp.status === 429 || resp.status === 403) {
      try {
        return await searchUserFallback(username);
      } catch (e) {
        await sleep(1200);
        try {
          return await scrapeProfilePage(username);
        } catch (e2) {
          throw new Error("User lookup blocked (" + resp.status + "). " + e2.message);
        }
      }
    }
    if (!resp.ok) throw new Error("Error looking up @" + username + " (" + resp.status + ")");
    var json;
    try {
      json = await resp.json();
    } catch (e) {
      throw new Error("Invalid response from Instagram. Please refresh the page.");
    }
    var user = (json.data || {}).user;
    if (!user) throw new Error("User @" + username + " not found.");
    return {
      id: user.id,
      username: user.username,
      isPrivate: !!user.is_private,
      isFollowedByViewer: !!user.followed_by_viewer
    };
  }

  function toast(msg) {
    var t = document.createElement("div");
    t.className = "igt-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function() { t.style.opacity = "0"; t.style.transition = "opacity .4s"; }, 2800);
    setTimeout(function() { if (t.parentNode) t.parentNode.removeChild(t); }, 3200);
  }

  async function ensureHashes() {
    var needRefresh = false;
    if (!HASHES.following || !HASHES.followers) needRefresh = true;

    if (!needRefresh) {
      try {
        var userId = getCookie("ds_user_id");
        if (!userId) throw new Error("Not logged in");
        var test = await graphqlFetch(HASHES.following, userId, null);
        var ud = ((test || {}).data || {}).user || {};
        if (!ud.edge_follow) needRefresh = true;
      } catch (e) {
        needRefresh = true;
      }
    }

    if (needRefresh) {
      if (!HASHES.following) HASHES.following = FALLBACK.following;
      if (!HASHES.followers) HASHES.followers = FALLBACK.followers;
      saveHashes(HASHES);

      try {
        var userId = getCookie("ds_user_id");
        if (userId) {
          var test = await graphqlFetch(HASHES.following, userId, null);
          var ud = ((test || {}).data || {}).user || {};
          if (!ud.edge_follow) {
            if (!hashMessageShown) {
              toast("Please visit your profile and open Followers or Following so the script can capture the current API hash.");
              hashMessageShown = true;
            }
            throw new Error("Hash refresh needed. Visit your profile > Followers or Following.");
          }
        }
      } catch (e) {
        if (e.message.indexOf("Hash refresh needed") !== -1) throw e;
        if (!hashMessageShown) {
          toast("Hashes may be outdated. Please visit your profile and open Followers/Following to refresh.");
          hashMessageShown = true;
        }
        throw new Error("Unable to verify API hashes. Please visit your profile > Followers/Following.");
      }
    }
  }

  // ================================================================
  //  EXPORT HELPERS
  // ================================================================
  function copyToClipboard(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast("Copied to clipboard");
    } catch (e) {
      toast("Copy failed");
    }
    document.body.removeChild(ta);
  }

  function downloadFile(content, filename, mime) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function() {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // ================================================================
  //  UI STYLES — clean dark theme
  // ================================================================
  var css = [
    "#igt-float{position:fixed;bottom:20px;right:20px;width:44px;height:44px;border-radius:50%;",
    "background:#1e1e1e;border:1px solid #333;box-shadow:0 4px 16px rgba(0,0,0,.4);",
    "z-index:1000;cursor:pointer;display:flex;align-items:center;justify-content:center;",
    "transition:transform .25s cubic-bezier(.34,1.56,.64,1),box-shadow .25s;user-select:none;}",
    "#igt-float:hover{transform:scale(1.1);box-shadow:0 6px 24px rgba(99,102,241,.25);border-color:#6366f1;}",
    "#igt-float svg{width:20px;height:20px;fill:#e0e0e0;}",
    "#igt-badge{position:absolute;top:-3px;right:-3px;min-width:18px;height:18px;background:#6366f1;",
    "border-radius:9px;color:#fff;font-size:10px;font-weight:800;display:none;align-items:center;",
    "justify-content:center;padding:0 5px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}",
    "#igt-panel{position:fixed;bottom:74px;right:20px;width:380px;max-height:520px;",
    "background:#121212;border:1px solid #2a2a2a;border-radius:18px;",
    "box-shadow:0 20px 60px rgba(0,0,0,.5);z-index:1001;overflow:hidden;",
    "display:none;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;",
    "font-size:13px;color:#e0e0e0;animation:igt-slide .35s cubic-bezier(.34,1.56,.64,1);user-select:none;}",
    "@keyframes igt-slide{from{opacity:0;transform:translateY(16px) scale(.95);}",
    "to{opacity:1;transform:translateY(0) scale(1);}}",
    "#igt-panel-header{display:flex;align-items:center;justify-content:space-between;",
    "padding:18px 20px 14px;border-bottom:1px solid #2a2a2a;}",
    "#igt-panel-header h2{font-size:17px;font-weight:800;margin:0;letter-spacing:-.3px;color:#fff;}",
    "#igt-panel-close{background:none;border:none;font-size:22px;cursor:pointer;color:#888;padding:0;line-height:1;}",
    "#igt-panel-close:hover{color:#fff;}",
    "#igt-target-bar{display:flex;gap:10px;padding:12px 20px;border-bottom:1px solid #2a2a2a;",
    "background:#1a1a1a;position:relative;}",
    "#igt-target-input{flex:1;border:1px solid #333;border-radius:10px;padding:9px 12px;",
    "font-size:13px;outline:none;font-family:inherit;background:#1e1e1e;color:#fff;",
    "transition:border-color .2s,box-shadow .2s;}",
    "#igt-target-input:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.15);}",
    "#igt-target-input::placeholder{color:#888;}",
    "#igt-target-btn{border:none;border-radius:10px;background:#6366f1;",
    "color:#fff;padding:9px 14px;font-size:12px;font-weight:700;cursor:pointer;transition:opacity .2s,transform .15s;}",
    "#igt-target-btn:hover{opacity:.9;transform:scale(1.02);}",
    "#igt-target-btn:disabled{opacity:.4;cursor:default;transform:none;}",
    "#igt-target-current{font-size:12px;color:#888;padding:4px 20px 0;}",
    "#igt-recent-dropdown{position:absolute;top:calc(100% + 4px);left:20px;right:68px;max-height:220px;",
    "overflow-y:auto;background:#1e1e1e;border:1px solid #333;border-radius:12px;",
    "box-shadow:0 8px 24px rgba(0,0,0,.5);z-index:1003;display:none;}",
    "#igt-recent-dropdown.visible{display:block;}",
    ".igt-recent-item{padding:10px 14px;cursor:pointer;font-size:13px;color:#e0e0e0;",
    "border-bottom:1px solid #2a2a2a;transition:background .15s;}",
    ".igt-recent-item:hover{background:#2a2a2a;}",
    ".igt-recent-item:last-child{border-bottom:none;}",
    "#igt-tabs{display:flex;gap:0;padding:0 20px;border-bottom:1px solid #2a2a2a;}",
    "#igt-tabs button{background:none;border:none;padding:10px 14px;font-size:13px;font-weight:600;",
    "color:#888;cursor:pointer;border-bottom:2px solid transparent;transition:color .2s,border-color .2s;}",
    "#igt-tabs button:hover{color:#fff;}",
    "#igt-tabs button.active{color:#fff;border-bottom-color:#6366f1;}",
    "#igt-panel-body{overflow-y:auto;flex:1;padding:14px 20px;}",
    ".igt-stat-row{display:flex;gap:12px;margin-bottom:14px;}",
    ".igt-stat{flex:1;background:#1a1a1a;border-radius:14px;padding:14px;text-align:center;",
    "border:1px solid #2a2a2a;}",
    ".igt-stat-val{font-size:26px;font-weight:800;letter-spacing:-.5px;color:#fff;}",
    ".igt-stat-lbl{font-size:11px;color:#888;margin-top:3px;text-transform:uppercase;letter-spacing:.6px;font-weight:700;}",
    ".igt-section-title{display:flex;align-items:center;justify-content:space-between;font-size:12px;",
    "font-weight:800;color:#888;text-transform:uppercase;letter-spacing:.6px;margin:12px 0 8px;}",
    ".igt-export-bar{display:flex;gap:6px;margin-bottom:10px;}",
    ".igt-export-btn{border:1px solid #333;border-radius:8px;background:#1a1a1a;padding:6px 10px;",
    "font-size:11px;font-weight:700;color:#e0e0e0;cursor:pointer;transition:all .15s;}",
    ".igt-export-btn:hover{background:#2a2a2a;border-color:#6366f1;}",
    ".igt-user-row{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;",
    "border-radius:10px;transition:background .15s;}",
    ".igt-user-row:hover{background:#1a1a1a;}",
    ".igt-user-row a{color:#e0e0e0;text-decoration:none;font-weight:600;font-size:13px;}",
    ".igt-user-row a:hover{color:#6366f1;}",
    ".igt-user-tag{font-size:11px;color:#fff;font-weight:700;background:#6366f1;",
    "padding:3px 8px;border-radius:6px;}",
    ".igt-scan-status{font-size:12px;color:#888;text-align:center;padding:8px 0;margin-bottom:6px;}",
    ".igt-scan-progress{height:4px;background:#2a2a2a;border-radius:2px;margin-bottom:12px;overflow:hidden;}",
    ".igt-scan-progress-bar{height:100%;width:0%;background:#6366f1;border-radius:2px;transition:width .3s;}",
    "#igt-scan-btn{width:100%;padding:12px;border:none;border-radius:12px;",
    "background:#6366f1;color:#fff;font-weight:800;font-size:14px;",
    "cursor:pointer;transition:opacity .2s,transform .15s;}",
    "#igt-scan-btn:hover{opacity:.9;transform:scale(1.01);}",
    "#igt-scan-btn:disabled{opacity:.4;transform:none;cursor:default;}",
    ".igt-empty{text-align:center;color:#888;padding:28px 0;font-size:13px;}",
    ".igt-toast{position:fixed;top:20px;right:20px;z-index:1002;",
    "background:#1e1e1e;border:1px solid #333;color:#fff;padding:12px 16px;",
    "border-radius:14px;font-size:13px;font-weight:700;box-shadow:0 8px 32px rgba(0,0,0,.4);",
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
    panel.innerHTML = '<div id="igt-panel-header"><h2>Unfollow Tracker</h2><button id="igt-panel-close">&times;</button></div><div id="igt-target-bar"><input id="igt-target-input" type="text" placeholder="username (leave blank for yourself)" autocomplete="off" /><button id="igt-target-btn">Go</button><div id="igt-recent-dropdown"></div></div><div id="igt-target-current"></div><div id="igt-tabs"><button data-tab="overview" class="active">Overview</button><button data-tab="unfollowers">Unfollowers</button><button data-tab="log">Activity</button></div><div id="igt-panel-body"></div>';
    document.body.appendChild(panel);

    var $body = document.getElementById("igt-panel-body");
    var targetInput = document.getElementById("igt-target-input");
    var targetBtn = document.getElementById("igt-target-btn");
    var targetCurrent = document.getElementById("igt-target-current");
    var recentDropdown = document.getElementById("igt-recent-dropdown");

    function buildRecentDropdown() {
      var list = loadRecent();
      if (!list.length) {
        recentDropdown.innerHTML = '';
        recentDropdown.classList.remove("visible");
        return;
      }
      var html = '';
      for (var i = 0; i < list.length; i++) {
        html += '<div class="igt-recent-item" data-user="' + list[i].username + '" data-id="' + list[i].id + '">@' + list[i].username + ' <span style="color:#888;font-size:11px;">' + new Date(list[i].at).toLocaleDateString() + '</span></div>';
      }
      recentDropdown.innerHTML = html;
      recentDropdown.classList.add("visible");
      document.querySelectorAll(".igt-recent-item").forEach(function(item) {
        item.onclick = function() {
          var username = item.getAttribute("data-user");
          var id = item.getAttribute("data-id");
          currentTarget.id = id;
          currentTarget.username = username;
          targetInput.value = username;
          targetCurrent.textContent = "Viewing: @" + username;
          recentDropdown.classList.remove("visible");
          render(loadData(id), "overview");
          toast("Switched to @" + username);
        };
      });
    }

    targetInput.addEventListener("focus", function() {
      buildRecentDropdown();
    });
    targetInput.addEventListener("blur", function() {
      setTimeout(function() { recentDropdown.classList.remove("visible"); }, 200);
    });
    targetInput.addEventListener("keydown", function(e) {
      if (e.key === "Enter") targetBtn.click();
    });

    targetBtn.onclick = async function() {
      var username = targetInput.value.trim();
      targetBtn.disabled = true;
      targetBtn.textContent = "...";
      try {
        var info = await resolveUsername(username);
        if (info.isPrivate && !info.isFollowedByViewer) {
          toast("@" + info.username + " is private. Cannot view.");
          targetBtn.disabled = false;
          targetBtn.textContent = "Go";
          return;
        }
        currentTarget.id = info.id;
        currentTarget.username = info.username;
        targetCurrent.textContent = "Viewing: @" + info.username + (info.isPrivate ? " (private)" : "");
        addRecent(info.username, info.id);
        toast("Resolved @" + info.username + " — ready to scan");
        render(loadData(info.id), "overview");
      } catch (err) {
        toast(err.message);
      }
      targetBtn.disabled = false;
      targetBtn.textContent = "Go";
    };

    // ================================================================
    //  SCAN
    // ================================================================
    async function runScan() {
      var userId = currentTarget.id;
      var targetUsername = currentTarget.username;
      if (!userId) {
        var selfId = getCookie("ds_user_id");
        if (!selfId) throw new Error("Not logged in to Instagram.");
        currentTarget.id = selfId;
        currentTarget.username = "Your Account";
        userId = selfId;
        targetUsername = "Your Account";
      }

      await ensureHashes();

      var following = await fetchAllGraphQL(HASHES.following || FALLBACK.following, userId, "Following");
      await jitteredSleep(2000);
      var followers = await fetchAllGraphQL(HASHES.followers || FALLBACK.followers, userId, "Followers");

      var old = loadData(userId);
      var oldFollowers = old.followers || [];
      var oldNotFB = (old.following || []).filter(function(u) { return (old.followers || []).indexOf(u) === -1; });
      var unfollowedMe = oldFollowers.filter(function(u) { return followers.indexOf(u) === -1; });
      var log = old.log || [];

      for (var i = 0; i < unfollowedMe.length; i++) {
        if (old.scannedAt) {
          log.push({ msg: "@" + unfollowedMe[i] + " unfollowed @" + targetUsername, at: Date.now() });
          toast("@" + unfollowedMe[i] + " unfollowed @" + targetUsername);
          await sleep(300);
        }
      }

      var data = { following: following, followers: followers, priorNotFB: oldNotFB, scannedAt: Date.now(), log: log, targetUsername: targetUsername };
      saveData(userId, data);

      var notFB = following.filter(function(u) { return followers.indexOf(u) === -1; });
      var newUF = notFB.filter(function(u) { return oldNotFB.indexOf(u) === -1; });
      if (newUF.length && targetUsername === "Your Account") {
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
      var targetUsername = data.targetUsername || currentTarget.username || "Your Account";

      var html = "";
      if (tab === "overview") {
        html += '<div class="igt-stat-row">';
        html += '<div class="igt-stat"><div class="igt-stat-val">' + following.length + '</div><div class="igt-stat-lbl">Following</div></div>';
        html += '<div class="igt-stat"><div class="igt-stat-val">' + followers.length + '</div><div class="igt-stat-lbl">Followers</div></div>';
        html += '<div class="igt-stat"><div class="igt-stat-val">' + notFB.length + '</div><div class="igt-stat-lbl">Not Back</div></div>';
        html += '</div>';
        html += '<div style="font-size:11px;color:#888;text-align:center;margin-bottom:10px;">@' + targetUsername + " — Last scan: " + (data.scannedAt ? new Date(data.scannedAt).toLocaleString() : "never") + '</div>';
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
          html += '<div class="igt-section-title"><span>Don\'t Follow Back (' + notFB.length + ') — @' + targetUsername + '</span></div>';
          html += '<div class="igt-export-bar">';
          html += '<button class="igt-export-btn" id="igt-copy-unfollowers">Copy List</button>';
          html += '<button class="igt-export-btn" id="igt-csv-unfollowers">Export CSV</button>';
          html += '<button class="igt-export-btn" id="igt-txt-unfollowers">Export TXT</button>';
          html += '</div>';
          for (var j = 0; j < notFB.length; j++) {
            var isNew = newlyUnfollowed.indexOf(notFB[j]) >= 0;
            html += '<div class="igt-user-row"><a href="https://instagram.com/' + notFB[j] + '" target="_blank">@' + notFB[j] + '</a>' + (isNew ? '<span class="igt-user-tag">NEW</span>' : '') + '</div>';
          }
        } else {
          html += '<div class="igt-empty">Everyone follows @' + targetUsername + ' back</div>';
        }
      } else if (tab === "log") {
        if (log.length) {
          html += '<div class="igt-section-title">Recent Activity — @' + targetUsername + '</div>';
          var reversed = log.slice().reverse();
          for (var k = 0; k < reversed.length && k < 30; k++) {
            html += '<div class="igt-user-row"><span>' + reversed[k].msg + '</span><span style="font-size:11px;color:#888;">' + new Date(reversed[k].at).toLocaleString() + '</span></div>';
          }
        } else {
          html += '<div class="igt-empty">No activity yet</div>';
        }
      }
      $body.innerHTML = html;

      var copyBtn = $body.querySelector("#igt-copy-unfollowers");
      if (copyBtn) {
        copyBtn.onclick = function() {
          var text = notFB.map(function(u) { return "@" + u; }).join("\n");
          copyToClipboard(text);
        };
      }
      var csvBtn = $body.querySelector("#igt-csv-unfollowers");
      if (csvBtn) {
        csvBtn.onclick = function() {
          var csv = "Username,Link,Status\n";
          for (var i = 0; i < notFB.length; i++) {
            var isNew = newlyUnfollowed.indexOf(notFB[i]) >= 0;
            csv += notFB[i] + ",https://instagram.com/" + notFB[i] + "," + (isNew ? "NEW" : "") + "\n";
          }
          downloadFile(csv, "unfollowers_" + targetUsername + "_" + new Date().toISOString().slice(0,10) + ".csv", "text/csv");
          toast("CSV downloaded");
        };
      }
      var txtBtn = $body.querySelector("#igt-txt-unfollowers");
      if (txtBtn) {
        txtBtn.onclick = function() {
          var txt = "Unfollowers for @" + targetUsername + "\n";
          txt += "Scanned: " + (data.scannedAt ? new Date(data.scannedAt).toLocaleString() : "never") + "\n";
          txt += "Total: " + notFB.length + "\n\n";
          for (var i = 0; i < notFB.length; i++) {
            var isNew = newlyUnfollowed.indexOf(notFB[i]) >= 0;
            txt += (i + 1) + ". @" + notFB[i] + (isNew ? " [NEW]" : "") + "\n";
          }
          downloadFile(txt, "unfollowers_" + targetUsername + "_" + new Date().toISOString().slice(0,10) + ".txt", "text/plain");
          toast("TXT downloaded");
        };
      }

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
            progress = Math.min(92, progress + 1.5);
            if (barEl) barEl.style.width = progress + "%";
          }, 800);

          try {
            var newData = await runScan();
            clearInterval(tick);
            if (progressEl) progressEl.style.display = "none";
            if (statusEl) statusEl.textContent = "";
            sb.textContent = "Scan Now";
            sb.disabled = false;
            var activeTab = document.querySelector("#igt-tabs button.active");
            render(newData, activeTab ? activeTab.dataset.tab : "overview");
            toast("Done: " + newData.following.length + " following, " + newData.followers.length + " followers for @" + targetUsername);
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
      if (!vis) {
        var selfId = getCookie("ds_user_id");
        var data = currentTarget.id ? loadData(currentTarget.id) : (selfId ? loadData(selfId) : {});
        render(data, "overview");
      }
    };
    document.getElementById("igt-panel-close").onclick = function() { panel.style.display = "none"; };

    // -- auto-scan --
    async function maybeAutoScan() {
      var selfId = getCookie("ds_user_id");
      if (!selfId) return;
      var oldData = loadData(selfId);
      if (oldData.scannedAt && Date.now() - oldData.scannedAt < COOLDOWN_MS) return;
      try {
        currentTarget.id = selfId;
        currentTarget.username = "Your Account";
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
    var selfId = getCookie("ds_user_id");
    if (selfId) {
      var initial = loadData(selfId);
      if (initial.following && initial.followers) {
        var initNotFB = initial.following.filter(function(u) { return initial.followers.indexOf(u) === -1; });
        var initNewUF = initNotFB.filter(function(u) { return (initial.priorNotFB || []).indexOf(u) === -1; });
        if (initNewUF.length) { badge.textContent = initNewUF.length; badge.style.display = "flex"; }
      }
    }

    setTimeout(function() {
      maybeAutoScan();
    }, 8000 + Math.random() * 4000);
  });
})();