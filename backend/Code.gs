/**
 * Kids TV backend: Google Apps Script bound to a Google Sheet.
 *
 * Holds the shared channel list (sheet "Channels"), checks the parent PIN,
 * and fetches videos from the YouTube Data API so the API key never reaches a phone.
 *
 * Script properties (Project Settings > Script properties):
 *   YT_API_KEY  = your YouTube Data API v3 key
 *   ADMIN_PIN   = the parent PIN for the Admin page (e.g. 4 to 6 digits)
 */

var MAX_CHANNELS = 20;
var SHEET_NAME = 'Channels';
var HEADERS = ['channelId', 'title', 'thumbnail', 'uploadsPlaylistId', 'addedAt'];
var VIDEO_CACHE_SECONDS = 60 * 60; // 1 hour

// ---------- HTTP entry points ----------

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'videos') return json_({ ok: true, videos: getVideos_(p.channelId) });
    return json_({ ok: true, channels: listChannels_() });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

// The app posts JSON as text/plain (avoids a CORS preflight).
function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!checkPin_(body.pin)) return json_({ ok: false, error: 'Wrong PIN' });
    if (body.action === 'checkPin') return json_({ ok: true });
    if (body.action === 'search') return json_({ ok: true, results: searchChannels_(body.query) });
    if (body.action === 'add') return json_({ ok: true, channel: addChannel_(body.input), channels: listChannels_() });
    if (body.action === 'remove') { removeChannel_(body.channelId); return json_({ ok: true, channels: listChannels_() }); }
    if (body.action === 'move') { moveChannel_(body.channelId, body.direction); return json_({ ok: true, channels: listChannels_() }); }
    return json_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

// ---------- Channels (the shared list) ----------

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function listChannels_() {
  var rows = sheet_().getDataRange().getValues().slice(1);
  return rows
    .filter(function (r) { return r[0]; })
    .map(function (r) {
      return { id: String(r[0]), title: String(r[1]), thumbnail: String(r[2]), uploads: String(r[3]) };
    });
}

function addChannel_(input) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var existing = listChannels_();
    if (existing.length >= MAX_CHANNELS) throw new Error('The list is full (' + MAX_CHANNELS + ' channels). Remove one first.');
    var ch = resolveChannel_(input);
    if (existing.some(function (c) { return c.id === ch.id; })) throw new Error(ch.title + ' is already on the list.');
    sheet_().appendRow([ch.id, ch.title, ch.thumbnail, ch.uploads, new Date()]);
    return ch;
  } finally {
    lock.releaseLock();
  }
}

function removeChannel_(channelId) {
  var sh = sheet_();
  var values = sh.getDataRange().getValues();
  for (var i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]) === String(channelId)) sh.deleteRow(i + 1);
  }
  CacheService.getScriptCache().remove('v_' + channelId);
}

function moveChannel_(channelId, direction) {
  var sh = sheet_();
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) !== String(channelId)) continue;
    var j = direction === 'up' ? i - 1 : i + 1;
    if (j < 1 || j >= values.length) return;
    var a = sh.getRange(i + 1, 1, 1, HEADERS.length);
    var b = sh.getRange(j + 1, 1, 1, HEADERS.length);
    var av = a.getValues(), bv = b.getValues();
    a.setValues(bv); b.setValues(av);
    return;
  }
}

// Search channels by name (costs 100 API units, fine at a few searches a day).
function searchChannels_(query) {
  query = String(query || '').trim();
  if (!query) throw new Error('Type a channel name first.');
  var res = yt_('search', { part: 'snippet', type: 'channel', q: query, maxResults: 8, safeSearch: 'strict' });
  return (res.items || []).map(function (it) {
    var th = it.snippet.thumbnails || {};
    return {
      id: it.snippet.channelId,
      title: it.snippet.title,
      description: it.snippet.description,
      thumbnail: (th.high || th.medium || th['default'] || {}).url || ''
    };
  });
}

// Accepts a channel link (youtube.com/@handle, /channel/UC..., /c/name, /user/name),
// an @handle, or a raw UC... channel id.
function resolveChannel_(input) {
  input = String(input || '').trim();
  if (!input) throw new Error('Paste a channel link first.');
  var params = { part: 'snippet,contentDetails' };
  var m;
  if ((m = input.match(/(UC[\w-]{22})/))) params.id = m[1];
  else if ((m = input.match(/@([\w.\-]+)/))) params.forHandle = '@' + m[1];
  else if ((m = input.match(/youtube\.com\/user\/([\w.\-]+)/i))) params.forUsername = m[1];
  else if ((m = input.match(/youtube\.com\/c\/([\w.\-]+)/i))) params.forHandle = '@' + m[1];
  else if (/^[\w.\-]+$/.test(input)) params.forHandle = '@' + input;
  else throw new Error('That does not look like a YouTube channel link. Open the channel in YouTube, tap Share, and copy the link.');

  var res = yt_('channels', params);
  var item = res.items && res.items[0];
  if (!item) throw new Error('Could not find that channel. Try the link from the channel page itself.');
  var th = item.snippet.thumbnails || {};
  return {
    id: item.id,
    title: item.snippet.title,
    thumbnail: (th.high || th.medium || th['default'] || {}).url || '',
    uploads: item.contentDetails.relatedPlaylists.uploads
  };
}

// ---------- Videos ----------

function getVideos_(channelId) {
  if (!channelId) throw new Error('Missing channelId');
  var cache = CacheService.getScriptCache();
  var key = 'v_' + channelId;
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  // Only channels on the shared list can be fetched.
  var ch = listChannels_().filter(function (c) { return c.id === channelId; })[0];
  if (!ch) throw new Error('That channel is not on the list.');
  var uploads = ch.uploads || ('UU' + channelId.slice(2));

  var pl = yt_('playlistItems', { part: 'contentDetails', playlistId: uploads, maxResults: 50 });
  var ids = (pl.items || []).map(function (it) { return it.contentDetails.videoId; });
  if (!ids.length) return [];

  // Keep only public, embeddable, already-published videos.
  var vr = yt_('videos', { part: 'snippet,status,contentDetails', id: ids.join(','), maxResults: 50 });
  var items = (vr.items || []).filter(function (v) {
    return v.status.embeddable && v.status.privacyStatus === 'public' && v.snippet.liveBroadcastContent === 'none';
  });
  var shorts = findShorts_(items);
  var videos = items
    .filter(function (v) { return !shorts[v.id]; })
    .map(function (v) {
      var th = v.snippet.thumbnails || {};
      return {
        id: v.id,
        title: v.snippet.title,
        thumbnail: (th.high || th.medium || th['default'] || {}).url || '',
        publishedAt: v.snippet.publishedAt
      };
    })
    .sort(function (a, b) { return a.publishedAt < b.publishedAt ? 1 : -1; });

  try { cache.put(key, JSON.stringify(videos), VIDEO_CACHE_SECONDS); } catch (e) { /* too big to cache: fine */ }
  return videos;
}

// Shorts are vertical, endless-swipe videos; hide them.
// youtube.com/shorts/ID answers 200 for a Short and redirects for a normal video.
// If that check fails, fall back to "60 seconds or less = Short".
function findShorts_(items) {
  var out = {};
  var requests = items.map(function (v) {
    return { url: 'https://www.youtube.com/shorts/' + v.id, method: 'head', followRedirects: false, muteHttpExceptions: true };
  });
  var responses = [];
  try { responses = UrlFetchApp.fetchAll(requests); } catch (e) { responses = []; }
  items.forEach(function (v, i) {
    var r = responses[i];
    if (r) {
      var code = r.getResponseCode();
      if (code === 200) { out[v.id] = true; return; }
      if (code >= 300 && code < 400) return;
    }
    if (isoSeconds_(v.contentDetails.duration) <= 60) out[v.id] = true;
  });
  return out;
}

function isoSeconds_(d) {
  var m = String(d || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
}

// ---------- Helpers ----------

function yt_(resource, params) {
  var key = PropertiesService.getScriptProperties().getProperty('YT_API_KEY');
  if (!key) throw new Error('YT_API_KEY is not set in Script properties.');
  params.key = key;
  var qs = Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  }).join('&');
  var res = UrlFetchApp.fetch('https://www.googleapis.com/youtube/v3/' + resource + '?' + qs, { muteHttpExceptions: true });
  var data = JSON.parse(res.getContentText());
  if (res.getResponseCode() !== 200) {
    throw new Error('YouTube API error: ' + ((data.error && data.error.message) || res.getResponseCode()));
  }
  return data;
}

function checkPin_(pin) {
  var real = PropertiesService.getScriptProperties().getProperty('ADMIN_PIN');
  return !!real && String(pin) === String(real);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Run once from the editor to check your setup (View > Logs).
function testSetup() {
  sheet_();
  Logger.log('Channels on list: ' + listChannels_().length);
  Logger.log(JSON.stringify(resolveChannel_('@MsRachel')));
}
