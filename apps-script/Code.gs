/**
 * Bihar grid and weather link
 * --------------------------------------------------------------
 * Lives in the "Bihar Grid Weather Archive" sheet (main sheet). Reads outages from the History Divisions
 * tabs of "Daily Outage Analytics - Bihar" and supply complaints from the 1912 sheet (both read only),
 * and serves the page (Index.html). The Weather Link and CC Import tabs are no longer used.
 *  1. Weather history  : saves each circle's rain and gusts every day
 *  2. Morning alert    : email with yesterday's flags and the next 48 h risk
 *  3. Long archive     : keeps circle and division figures beyond the 20-day history tabs
 *  4. Data feed        : one JSON feed for the weather page (no raw tabs exposed)
 *  5. Prediction       : today's and tomorrow's outages and supply complaints per circle,
 *                        checked against actuals the next day
 *  6. Drive archive    : every day saved to your Drive folder as a master sheet
 *                        (Bihar Grid Weather Archive) and one JSON file per day
 *
 * Setup (once):
 *  a) In the archive sheet: Extensions > Apps Script. Paste this as Code.gs, add an HTML file
 *     named Index with the weather page, Save.
 *  b) Run setup() and allow the permissions it asks for.
 *  c) Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 *     The web app URL opens the page; URL?days=14 still returns the JSON feed.
 */

var CFG = {
  SOURCE_SHEET_ID: '19cDJxYkrnSSUBB30-IMztkg-9sCtZhxd0aD4iFo29rA', // Daily Outage Analytics - Bihar (read only)
  MAIN_SHEET_ID: '1TutxPDHeNdIuC0mGgTDn8Y5fpVmPaOqm2XYYcELiU9E',   // Bihar Grid Weather Archive (this sheet)
  COMPLAINT_SHEET_ID: '1MyjzcCz-IUs1GNEtKQHHohRwtG-FEhpFirb4uAWrguU', // Customer Call Center 1912 (read only, used for the daily cross-check)
  RECIPIENTS: [],          // add emails, e.g. ['md@example.com','se.patna@example.com']; empty = sheet owner
  RUN_HOUR: 9,             // earliest daily run, IST (hour)
  RUN_MINUTE: 30,          // earliest daily run, IST (minute). A 30-minute check runs the day as soon as both source sheets are ready
  LAST_HOUR: 13,           // if the source data is still not ready by this hour, run anyway and flag it in the email
  DEFAULT_RAIN_MM: 15,     // rain rule used until a circle has learned its own
  GUST_KMH: 45,            // gust rule for all circles
  IMPACT_X: 1.8,           // "well above normal" multiple
  NORMAL_WINDOW: 28,       // days used to work out each circle's normal
  MIN_SAMPLES: 5,          // rainy days needed in a band before a circle threshold is trusted (one storm alone gives about 3)
  MIN_HISTORY_DAYS: 30,    // days of grid history needed before any circle threshold is learned
  RAIN_BANDS: [5, 15, 25, 40, 60],
  FEED_MAX_DAYS: 120,
  DIVISION_DAYS: 7,        // days of division detail sent to the page
  PRED_MIN_ROWS: 40,       // training rows needed before the model is used (else a simple carry-over estimate)
  PRED_TRUSTED_DAYS: 60,   // days of history after which predictions are no longer marked as learning
  RIDGE: 1,                // keeps the model steady while history is short
  ARCHIVE_FOLDER_ID: '10dRW1YDnCwmcKPHYiQP6FJkOBpfN3bMO',   // Drive folder "WeatherPrediction"
  ARCHIVE_SHEET_NAME: 'Bihar Grid Weather Archive',
  ARCHIVE_REDO_DAYS: 3,    // re-save the last few days each morning, in case source figures were corrected
  TZ: 'Asia/Kolkata'
};

var DISTRICTS = {
  'Araria':[26.15,87.47],'Arwal':[25.25,84.68],'Aurangabad':[24.75,84.37],'Banka':[24.88,86.92],'Begusarai':[25.42,86.13],
  'Bhagalpur':[25.25,87.01],'Bhojpur':[25.56,84.66],'Buxar':[25.56,83.98],'Darbhanga':[26.15,85.9],'East Champaran':[26.65,84.92],
  'Gaya':[24.79,85.0],'Gopalganj':[26.47,84.44],'Jamui':[24.92,86.22],'Jehanabad':[25.21,84.99],'Kaimur':[25.04,83.61],
  'Katihar':[25.54,87.58],'Khagaria':[25.5,86.48],'Kishanganj':[26.1,87.95],'Lakhisarai':[25.17,86.09],'Madhepura':[25.92,86.79],
  'Madhubani':[26.35,86.07],'Munger':[25.37,86.47],'Muzaffarpur':[26.12,85.39],'Nalanda':[25.2,85.52],'Nawada':[24.89,85.54],
  'Patna':[25.59,85.14],'Purnia':[25.78,87.47],'Rohtas':[24.95,84.03],'Saharsa':[25.88,86.6],'Samastipur':[25.86,85.78],
  'Saran':[25.78,84.73],'Sheikhpura':[25.14,85.85],'Sheohar':[26.51,85.29],'Sitamarhi':[26.6,85.48],'Siwan':[26.22,84.36],
  'Supaul':[26.12,86.6],'Vaishali':[25.69,85.21],'West Champaran':[26.8,84.5]
};

// Discom, circle (outage sheet name), districts covered, circle name in the 1912 sheet when different
var CIRCLES = [
  ['SBPDCL','ARRAH',['Bhojpur','Buxar'],'ARA'],
  ['SBPDCL','AURANGABAD',['Aurangabad','Arwal']],
  ['SBPDCL','BHAGALPUR',['Bhagalpur','Banka']],
  ['SBPDCL','BIHARSARIF',['Nalanda','Nawada','Sheikhpura'],'NALANDA'],
  ['SBPDCL','GAYA JI',['Gaya','Jehanabad'],'GAYA'],
  ['SBPDCL','JAMUI',['Jamui','Lakhisarai']],
  ['SBPDCL','MUNGER',['Munger']],
  ['SBPDCL','PATNA',['Patna']],
  ['SBPDCL','PESU EAST',['Patna']],
  ['SBPDCL','PESU WEST',['Patna']],
  ['SBPDCL','SASARAM',['Rohtas','Kaimur']],
  ['NBPDCL','BEGUSARAI',['Begusarai','Khagaria']],
  ['NBPDCL','CHAPRA',['Saran','Siwan','Gopalganj']],
  ['NBPDCL','DARBHANGA',['Darbhanga','Madhubani']],
  ['NBPDCL','KISHANGANJ',['Kishanganj','Araria']],
  ['NBPDCL','MOTIHARI',['East Champaran','West Champaran']],
  ['NBPDCL','MUZAFFARPUR',['Muzaffarpur','Sitamarhi','Sheohar','Vaishali']],
  ['NBPDCL','PURNEA',['Purnia','Katihar']],
  ['NBPDCL','SAHARSA',['Saharsa','Supaul','Madhepura']],
  ['NBPDCL','SAMASTIPUR',['Samastipur']]
];

var SH = {
  W: {name:'Weather History',   head:['Date','Circle','Discom','Rain mm','Max Gust km/h','Max Temp C','Updated']},
  F: {name:'Weather Forecast',  head:['Date','Circle','Discom','Rain mm','Max Gust km/h','Max Temp C','Updated']},
  G: {name:'Grid History',      head:['Date','Circle','Discom','Total Feeders','Feeders With Outage','Interruptions','Outage Min','Feeders Over 4 Hrs','Supply Complaints','Updated']},
  D: {name:'Division History',  head:['Date','Discom','Circle','Division','Total Feeders','Feeders With Outage','Interruptions','Outage Min','Feeders Over 4 Hrs','Updated']},
  T: {name:'Circle Thresholds', head:['Circle','Discom','Rain Threshold mm','Basis','Days Of History','Rainy Days','Normal Outage Min Per Feeder','Normal Supply Complaints','Updated']},
  P: {name:'Predictions',       head:['Target Date','Circle','Lead Days','Discom','Made On','Outage Min','Outage Min Low','Outage Min High','Supply Complaints','Complaints Low','Complaints High','Risk','Actual Outage Min','Actual Complaints','Outage In Range','Complaints In Range']},
  M: {name:'Model',             head:['Target','Feature','Coefficient','Training Rows','Residual SD','Updated']},
  L: {name:'Run Log',           head:['Time','Step','Status','Message']}
};

/* ===================== Entry points ===================== */

function setup() {
  Object.keys(SH).forEach(function (k) { sheet_(SH[k]); });
  step_('Copy old history', importOldTabs_);
  step_('Weather backfill', function () { return updateWeather_(92); });
  step_('Grid archive', archiveGrid_);
  step_('Division archive', archiveDivisions_);
  step_('Thresholds', computeThresholds_);
  step_('Prediction', predict_);
  step_('Drive archive (all history)', function () { return archiveToDrive_(true); });
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction(); if (h === 'runDaily' || h === 'runDailyRetry' || h === 'runIfDue' || h === 'runIfDueOnce') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runIfDue').timeBased().everyMinutes(30).create();
  log_('Setup', 'OK', 'Checks every 30 min from ' + CFG.RUN_HOUR + ':' + ('0' + CFG.RUN_MINUTE).slice(-2) + ' IST; runs once a day as soon as the outage and 1912 sheets are ready, or at ' + CFG.LAST_HOUR + ':00 with a warning');
}

/* Every 30 minutes: runs the day once, as soon as yesterday's outages and complaints are in. Quick no-op otherwise.
   A run cut off by Apps Script's 6-minute limit resumes at the next check from the step it reached.
   If the weather service was busy, the weather alone is retried at later checks (until 8 PM). */
function runIfDue() {
  var lock = LockService.getScriptLock(); if (!lock.tryLock(0)) return;
  try {
    var now = new Date(), today = ymd_(now), props = PropertiesService.getScriptProperties();
    var mins = +Utilities.formatDate(now, CFG.TZ, 'H') * 60 + +Utilities.formatDate(now, CFG.TZ, 'm');
    if (props.getProperty('DONE_DAY') === today) { if (props.getProperty('WX_DAY') !== today && mins < 20 * 60) retryWeather_(); return; }
    if (mins < CFG.RUN_HOUR * 60 + CFG.RUN_MINUTE) return;
    var resuming = !!props.getProperty('STEPS_' + today);
    if (!resuming) {
      try { checkSources_(); } catch (e) { /* SOURCE_LATE and SOURCE_ISSUES are set */ }
      if (SOURCE_LATE && mins < CFG.LAST_HOUR * 60) {
        var wk = 'WAIT_LOG_' + today, lastLog = +(props.getProperty(wk) || -999);
        if (mins - lastLog >= 55) { log_('Wait', 'OK', 'Source data not ready yet: ' + SOURCE_ISSUES.join('; ').slice(0, 240) + '. Checking again every 30 min until ' + CFG.LAST_HOUR + ':00'); props.setProperty(wk, String(mins)); }
        return;
      }
      if (SOURCE_LATE) log_('Wait', 'Error', 'Source data still not ready at ' + CFG.LAST_HOUR + ':00; running with the data available');
    }
    runDaily(true);
  } finally { lock.releaseLock(); }
}

/* old retry triggers from an earlier version clean themselves up */
function runDailyRetry() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'runDailyRetry') ScriptApp.deleteTrigger(t); });
}

/** The full daily run. Called by runIfDue (resume = true: skips steps already done today), or by hand at any time. */
function runDaily(resume) {
  var t0 = Date.now(), today = ymd_(new Date()), props = PropertiesService.getScriptProperties(), key = 'STEPS_' + today;
  var done = resume === true ? (props.getProperty(key) || '').split(',') : [];
  var steps = [
    ['Source check', checkSources_],
    ['Weather', function () { var m = updateWeather_(3); props.setProperty('WX_DAY', today); return m; }],
    ['Grid archive', archiveGrid_],
    ['Division archive', archiveDivisions_],
    ['Thresholds', computeThresholds_],
    ['Prediction', predict_],
    ['Drive archive', function () { return archiveToDrive_(false); }],
    ['Alert', function () { CacheService.getScriptCache().removeAll(['feed_14', 'feed_30', 'feed_90', 'feed_120']); return sendAlert_(); }]
  ];
  if (done.length > 1) log_('Resume', 'OK', 'Continuing today\'s run after: ' + done.filter(String).join(', '));
  for (var i = 0; i < steps.length; i++) {
    var name = steps[i][0];
    if (done.indexOf(name) > -1) continue;
    if (Date.now() - t0 > 4.5 * 60 * 1000) { log_('Pause', 'OK', 'Near the 6-minute limit; the next 30-minute check continues from ' + name); return; }
    step_(name, steps[i][1]);
    done.push(name); props.setProperty(key, done.filter(String).join(','));
  }
  props.setProperty('DONE_DAY', today);
}

/* weather alone, retried at later checks when the morning fetch was refused; refreshes the prediction afterwards */
function retryWeather_() {
  try {
    var m = updateWeather_(3, true);
    PropertiesService.getScriptProperties().setProperty('WX_DAY', ymd_(new Date()));
    log_('Weather retry', 'OK', m);
    step_('Prediction', predict_);
    CacheService.getScriptCache().removeAll(['feed_14', 'feed_30', 'feed_90', 'feed_120']);
  } catch (e) { /* still busy: try again at the next check, quietly */ }
}

/** Web app: no parameters = the weather page (Index.html); ?days=14|30|90 = the JSON feed */
function doGet(e) {
  selfHeal_();
  var p = (e && e.parameter) || {};
  if (p.days || p.feed) return ContentService.createTextOutput(feedJson_(p.days)).setMimeType(ContentService.MimeType.JSON);
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Bihar Grid Weather')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Called by the page through google.script.run */
function getFeed(days) { selfHeal_(); return feedJson_(days); }

/* Keeps the schedule alive without anyone running setup(): whenever the page is opened,
   the 30-minute trigger is re-created if missing, and if today's run is due but not done,
   a one-off run is started a minute later (the page is never kept waiting). */
function selfHeal_() {
  try {
    var hs = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
    if (hs.indexOf('runIfDue') < 0) { ScriptApp.newTrigger('runIfDue').timeBased().everyMinutes(30).create(); log_('Schedule', 'OK', 'Missing 30-minute trigger re-created'); }
    var props = PropertiesService.getScriptProperties(), now = new Date(), today = ymd_(now);
    if (props.getProperty('DONE_DAY') === today || hs.indexOf('runIfDueOnce') > -1) return;
    var mins = +Utilities.formatDate(now, CFG.TZ, 'H') * 60 + +Utilities.formatDate(now, CFG.TZ, 'm'), last = +(props.getProperty('KICK_AT') || 0);
    if (mins < CFG.RUN_HOUR * 60 + CFG.RUN_MINUTE || Date.now() - last < 20 * 60 * 1000) return;
    props.setProperty('KICK_AT', String(Date.now()));
    ScriptApp.newTrigger('runIfDueOnce').timeBased().after(60 * 1000).create();
  } catch (e) { /* never block the page */ }
}
function runIfDueOnce() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'runIfDueOnce') ScriptApp.deleteTrigger(t); });
  runIfDue();
}

function feedJson_(daysParam) {
  var days = Math.max(7, Math.min(CFG.FEED_MAX_DAYS, parseInt(daysParam || 14, 10) || 14));
  var cache = CacheService.getScriptCache(), key = 'feed_' + days, out = cache.get(key);
  if (!out) {
    try { out = JSON.stringify(buildData_(days)); }
    catch (err) { out = JSON.stringify({ ok: false, error: 'Could not build the feed' }); log_('Feed', 'Error', String(err)); }
    if (out.length < 95000) cache.put(key, out, 600);
  }
  return out;
}

/* ===================== 1. Weather ===================== */

function updateWeather_(pastDays, quiet) {
  var names = Object.keys(DISTRICTS);
  var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + names.map(function (n) { return DISTRICTS[n][0]; }).join(',') +
    '&longitude=' + names.map(function (n) { return DISTRICTS[n][1]; }).join(',') +
    '&daily=precipitation_sum,wind_gusts_10m_max,temperature_2m_max&past_days=' + pastDays + '&forecast_days=3&timezone=Asia%2FKolkata';
  // the free weather service sometimes answers 429 (busy) to Google's shared servers: one short retry here,
  // then runIfDue tries again every 30 minutes, so the daily run is never held up by the weather
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (!quiet && (res.getResponseCode() === 429 || res.getResponseCode() >= 500)) { Utilities.sleep(20000); res = UrlFetchApp.fetch(url, { muteHttpExceptions: true }); }
  if (res.getResponseCode() !== 200) throw new Error('Weather service returned ' + res.getResponseCode() + (res.getResponseCode() === 429 ? ' (busy); will retry every 30 minutes until it succeeds' : ''));
  var arr = JSON.parse(res.getContentText());
  if (!Array.isArray(arr)) arr = [arr];
  var byDist = {};
  arr.forEach(function (w, i) {
    var m = {};
    w.daily.time.forEach(function (t, j) { m[t] = [w.daily.precipitation_sum[j], w.daily.wind_gusts_10m_max[j], w.daily.temperature_2m_max[j]]; });
    byDist[names[i]] = m;
  });
  var dates = arr[0].daily.time, today = ymd_(new Date()), stamp = now_();
  var past = [], fut = [];
  CIRCLES.forEach(function (c) {
    dates.forEach(function (d) {
      var r = [], g = [], h = [];
      c[2].forEach(function (n) { var v = byDist[n] && byDist[n][d]; if (v) { if (v[0] != null) r.push(v[0]); if (v[1] != null) g.push(v[1]); if (v[2] != null) h.push(v[2]); } });
      if (!r.length && !g.length) return;
      var row = [d, c[1], c[0], r.length ? round_(avg_(r), 1) : '', g.length ? Math.round(Math.max.apply(null, g)) : '', h.length ? round_(Math.max.apply(null, h), 1) : '', stamp];
      (d < today ? past : fut).push(row);
    });
  });
  upsert_(SH.W, past, 2);
  var f = sheet_(SH.F);
  if (f.getLastRow() > 1) f.getRange(2, 1, f.getLastRow() - 1, SH.F.head.length).clearContent();
  if (fut.length) f.getRange(2, 1, fut.length, fut[0].length).setValues(fut);
  return past.length + ' history rows, ' + fut.length + ' forecast rows';
}

/* ===================== 3. Archive ===================== */

function archiveGrid_() {
  var stamp = now_(), div = divisionTotals_(), cc, rows = [];
  try { cc = complaints1912_(); } catch (e) { cc = { byKey: {}, cutoff: 'unavailable (' + (e.message || e) + ')' }; }
  Object.keys(div.byKey).forEach(function (k) {
    var a = div.byKey[k], sc = cc.byKey[k];
    if (!a.v[0]) return;
    rows.push([a.d, a.c, a.dc, a.v[0], a.v[1], a.v[2], round_(a.v[3], 2), a.v[4], sc == null ? '' : sc, stamp]);
  });
  upsert_(SH.G, rows, 2, [8]);   // keep an earlier complaint figure if the new one is blank
  var withC = rows.filter(function (r) { return r[8] !== ''; }).length;
  return rows.length + ' circle-days from division history, ' + withC + ' with 1912 complaints (1912 data to ' + cc.cutoff + ')';
}

/* Circle totals per day, summed from the SBPDCL and NBPDCL History Divisions tabs of the outage sheet */
function divisionTotals_() {
  var ss = src_(), byKey = {}, last = {}, dates = {};
  ['SBPDCL', 'NBPDCL'].forEach(function (dc) {
    var s = ss.getSheetByName(dc + ' History Divisions'); if (!s || s.getLastRow() < 2) return;
    s.getRange(2, 1, s.getLastRow() - 1, 10).getValues().forEach(function (r) {
      var d = serialToYmd_(r[1]) || asYmd_(r[0]); if (!d || !r[3]) return;
      var k = d + '|' + r[3], a = byKey[k] = byKey[k] || { d: d, c: r[3], dc: dc, v: [0, 0, 0, 0, 0] };
      for (var i = 0; i < 5; i++) a.v[i] += +r[5 + i] || 0;
      if (!last[dc] || d > last[dc]) last[dc] = d;
      dates[d] = 1;
    });
  });
  return { byKey: byKey, last: last, dates: Object.keys(dates).sort() };
}

/* Supply Related complaints per circle per day, read straight from the 1912 sheet (DB_GEO 14-day series ending at DB_META cutoff) */
function complaints1912_() {
  var cc = SpreadsheetApp.openById(CFG.COMPLAINT_SHEET_ID), meta = cc.getSheetByName('DB_META'), geo = cc.getSheetByName('DB_GEO');
  if (!meta || !geo) throw new Error('DB_META or DB_GEO tab not found in the 1912 sheet');
  var cutoff = '';
  meta.getRange(1, 1, meta.getLastRow(), 2).getValues().forEach(function (r) { if (r[0] === 'cutoff') cutoff = asYmd_(r[1]); });
  if (!cutoff) throw new Error('1912 sheet has no cutoff date in DB_META');
  var toOut = {}, known = {};
  CIRCLES.forEach(function (c) { toOut[c[0] + '|' + (c[3] || c[1])] = c[1]; known[c[1]] = 1; });
  var byKey = {}, perDiscom = {}, unknown = [];
  geo.getRange(2, 1, geo.getLastRow() - 1, 19).getValues().forEach(function (r) {
    if (r[0] !== 'Circle' || r[7] !== 'Supply Related') return;
    var name = toOut[r[1] + '|' + r[2]]; if (!name) { unknown.push(r[2]); return; }
    var sp = String(r[18]).split(',').map(function (x) { return +x; }), n = sp.length;
    sp.forEach(function (v, i) {
      var d = addDays_(cutoff, i - (n - 1));
      byKey[d + '|' + name] = v;
      var k = d + '|' + r[1]; perDiscom[k] = (perDiscom[k] || 0) + v;
    });
  });
  return { byKey: byKey, cutoff: cutoff, perDiscom: perDiscom, unknown: unknown, book: cc };
}

function archiveDivisions_() {
  var ss = src_(), stamp = now_(), rows = [];
  ['SBPDCL', 'NBPDCL'].forEach(function (dc) {
    var s = ss.getSheetByName(dc + ' History Divisions'); if (!s || s.getLastRow() < 2) return;
    s.getRange(2, 1, s.getLastRow() - 1, 10).getValues().forEach(function (r) {
      var d = serialToYmd_(r[1]) || asYmd_(r[0]); if (!d || !r[4]) return;
      rows.push([d, dc, r[3], r[4], +r[5], +r[6], +r[7], round_(+r[8], 2), +r[9], stamp]);
    });
  });
  upsert_(SH.D, rows, 4);
  return rows.length + ' rows';
}

/* ===================== Thresholds ===================== */

function computeThresholds_() {
  var J = joined_(), stamp = now_(), out = [];
  CIRCLES.forEach(function (c) {
    var days = J[c[1]] || {}, ds = Object.keys(days).sort();
    var dry = [], dryC = [], pts = [];
    ds.forEach(function (d, i) {
      var x = days[d]; if (x.opf == null) return;
      var prev = days[ds[i - 1]], rain = Math.max(x.rain || 0, prev && prev.rain || 0);
      if (x.rain != null && rain < 5) { dry.push(x.opf); if (x.sc != null) dryC.push(x.sc); }
      if (x.rain != null) pts.push([rain, x.opf]);
    });
    var gridDays = ds.filter(function (d) { return days[d].opf != null; }).length;
    var normal = median_(dry), thr = CFG.DEFAULT_RAIN_MM, basis = gridDays < CFG.MIN_HISTORY_DAYS ? 'Default (learning)' : 'Default';
    if (normal && gridDays >= CFG.MIN_HISTORY_DAYS) {
      var bands = CFG.RAIN_BANDS;
      for (var b = 0; b < bands.length; b++) {
        var lo = bands[b], hi = b + 1 < bands.length ? bands[b + 1] : 1e9;
        var inBand = pts.filter(function (p) { return p[0] >= lo && p[0] < hi; }).map(function (p) { return p[1] / normal; });
        if (inBand.length >= CFG.MIN_SAMPLES && median_(inBand) >= CFG.IMPACT_X) { thr = lo; basis = 'Learned'; break; }
      }
    }
    out.push([c[1], c[0], thr, basis, gridDays, pts.filter(function (p) { return p[0] >= 5; }).length,
      normal == null ? '' : round_(normal, 1), dryC.length ? Math.round(median_(dryC)) : '', stamp]);
  });
  var s = sheet_(SH.T);
  if (s.getLastRow() > 1) s.getRange(2, 1, s.getLastRow() - 1, SH.T.head.length).clearContent();
  s.getRange(2, 1, out.length, out[0].length).setValues(out);
  return out.filter(function (r) { return r[3] === 'Learned'; }).length + ' circles learned';
}

/* ===================== 4. Feed ===================== */

function buildData_(nDays) {
  var J = joined_(), thr = thresholds_(), fc = rows_(SH.F), NM = normals_(J);
  var allDates = {};
  Object.keys(J).forEach(function (c) { Object.keys(J[c]).forEach(function (d) { if (J[c][d].tf) allDates[d] = 1; }); });
  var dates = Object.keys(allDates).sort(), view = dates.slice(-nDays), first = view[0];
  var circles = CIRCLES.map(function (c) {
    var days = J[c[1]] || {}, t = thr[c[1]] || { thr: CFG.DEFAULT_RAIN_MM, basis: 'Default' }, out = {};
    view.forEach(function (d) {
      var x = days[d]; if (!x || !x.tf) return;
      var s = status_(days, d, t.thr);
      out[d] = [x.tf, x.fo, x.itr, round_(x.om, 0), x.o4, x.sc, x.rain, x.gust, s.ro, s.rc, s.st];
    });
    var nm = NM[c[1]] || {};
    return { c: c[1], dc: c[0], thr: t.thr, basis: t.basis, nOpf: nm.opf == null ? null : round_(nm.opf, 1), nSc: nm.sc == null ? null : Math.round(nm.sc), d: out };
  });
  // division detail for the most recent days
  var divDates = view.slice(-CFG.DIVISION_DAYS), divs = {};
  rows_(SH.D).forEach(function (r) {
    var d = asYmd_(r[0]); if (divDates.indexOf(d) < 0) return;
    (divs[d] = divs[d] || []).push([r[1], r[2], r[3], +r[4], +r[5], +r[6], Math.round(+r[7]), +r[8]]);
  });
  // forecast and 48 h risk
  var today = ymd_(new Date()), fcOut = {}, risk = [];
  fc.forEach(function (r) {
    var d = asYmd_(r[0]); if (!d || d < today) return;
    var c = r[1], rain = r[3] === '' ? null : +r[3], gust = r[4] === '' ? null : +r[4], t = (thr[c] || {}).thr || CFG.DEFAULT_RAIN_MM;
    (fcOut[c] = fcOut[c] || {})[d] = [rain, gust];
    var lim = addDays_(today, 1);
    if (d <= lim && ((rain != null && rain >= t) || (gust != null && gust >= CFG.GUST_KMH)))
      risk.push({ c: c, dc: r[2], date: d, rain: rain, gust: gust, thr: t });
  });
  risk.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (b.rain || 0) - (a.rain || 0); });
  return {
    ok: true, generated: now_(), asOf: view[view.length - 1] || null, from: first || null,
    cfg: { impactX: CFG.IMPACT_X, gust: CFG.GUST_KMH, defaultRain: CFG.DEFAULT_RAIN_MM },
    dates: view, circles: circles, divisions: divs, forecast: fcOut, risk: risk, prediction: predFeed_()
  };
}

/* status of one circle on one day against its own normal */
function status_(days, d, thrMm) {
  var ds = Object.keys(days).sort(), i = ds.indexOf(d), x = days[d];
  var win = ds.slice(Math.max(0, i - CFG.NORMAL_WINDOW), i + CFG.NORMAL_WINDOW + 1).filter(function (k) { return k !== d; });
  var nO = median_(win.map(function (k) { return days[k].opf; })), nC = median_(win.map(function (k) { return days[k].sc; }));
  var ro = (x.opf != null && nO) ? round_(x.opf / nO, 2) : null, rc = (x.sc != null && nC) ? round_(x.sc / nC, 2) : null;
  var prev = days[ds[i - 1]], rain = Math.max(x.rain || 0, (prev && prev.rain) || 0);
  var stress = rain >= thrMm || (x.gust || 0) >= CFG.GUST_KMH;
  var imp = Math.max(ro || 0, rc || 0);
  return { ro: ro, rc: rc, st: imp >= CFG.IMPACT_X ? (stress ? 'W' : 'B') : 'N' };
}

/* ===================== 2. Alert ===================== */

function sendAlert_() {
  var data = buildData_(CFG.NORMAL_WINDOW), d = data.asOf;
  if (!d) return 'No grid data, alert skipped';
  var beyond = [], weather = [];
  data.circles.forEach(function (c) {
    var x = c.d[d]; if (!x) return;
    var row = { c: c.c, dc: c.dc, opf: x[0] ? Math.round(x[3] / x[0]) : null, ro: x[8], sc: x[5], rc: x[9], o4: x[4], rain: x[6], gust: x[7] };
    if (x[10] === 'B') beyond.push(row); else if (x[10] === 'W') weather.push(row);
  });
  var by = function (a, b) { return Math.max(b.ro || 0, b.rc || 0) - Math.max(a.ro || 0, a.rc || 0); };
  beyond.sort(by); weather.sort(by);
  var dl = Utilities.formatDate(new Date(d + 'T00:00:00+05:30'), CFG.TZ, 'd MMM yyyy');
  var subject = 'Grid and weather, ' + dl + ': ' + beyond.length + ' beyond weather, ' + weather.length + ' weather-driven, ' +
    uniq_(data.risk.map(function (r) { return r.c; })).length + ' at risk in next 48 h';
  var css = 'font-family:Arial,sans-serif;font-size:13px;color:#10233a';
  var th = function (h) { return '<th style="text-align:left;padding:6px 8px;background:#eef4fb;border-bottom:1px solid #dde5ee">' + h + '</th>'; };
  var td = function (v) { return '<td style="padding:6px 8px;border-bottom:1px solid #eef1f5">' + (v == null || v === '' ? '–' : v) + '</td>'; };
  var x = function (v) { return v == null ? '' : ' (' + v.toFixed(1) + '×)'; };
  var table = function (list) {
    if (!list.length) return '<p style="color:#5d7088">None.</p>';
    return '<table style="border-collapse:collapse;' + css + '"><tr>' + th('Circle') + th('Outage min per feeder') + th('Supply complaints') +
      th('Feeders over 4 h') + th('Rain mm') + th('Gust km/h') + '</tr>' +
      list.map(function (r) { return '<tr>' + td('<b>' + r.c + '</b> <span style="color:#93a3b8">' + r.dc + '</span>') + td(r.opf + x(r.ro)) +
        td(r.sc + x(r.rc)) + td(r.o4) + td(r.rain) + td(r.gust) + '</tr>'; }).join('') + '</table>';
  };
  var riskT = data.risk.length ? '<table style="border-collapse:collapse;' + css + '"><tr>' + th('Date') + th('Circle') + th('Rain mm') +
    th('Circle limit mm') + th('Gust km/h') + '</tr>' + data.risk.map(function (r) {
      return '<tr>' + td(Utilities.formatDate(new Date(r.date + 'T00:00:00+05:30'), CFG.TZ, 'EEE d MMM')) + td('<b>' + r.c + '</b>') +
        td(r.rain) + td(r.thr) + td(r.gust) + '</tr>'; }).join('') + '</table>' : '<p style="color:#5d7088">No circle crosses its rain or gust limit.</p>';
  var pf = data.prediction, predHtml = '';
  if (pf && pf.totals) {
    var t0 = pf.totals[0], f = function (v) { return Number(v).toLocaleString('en-IN'); };
    var hiC = Object.keys(pf.circles).filter(function (c) { var p = pf.circles[c].p[0]; return p && p[6] !== 'Normal'; })
      .sort(function (a, b) { var r = { High: 0, Medium: 1 }; return r[pf.circles[a].p[0][6]] - r[pf.circles[b].p[0][6]]; });
    var tl = Utilities.formatDate(new Date(pf.targets[0] + 'T00:00:00+05:30'), CFG.TZ, 'EEE d MMM');
    predHtml = '<h3 style="color:#2d7fd3;font-size:14px;margin:14px 0 6px">Prediction for today, ' + tl + '</h3>' +
      '<p style="margin:0 0 6px">Outage hours: <b>' + f(Math.round(t0.om / 60)) + '</b> (likely ' + f(Math.round(t0.omLo / 60)) + ' to ' + f(Math.round(t0.omHi / 60)) + '). ' +
      'Supply complaints: <b>' + f(t0.sc) + '</b> (likely ' + f(t0.scLo) + ' to ' + f(t0.scHi) + ').</p>' +
      (hiC.length ? '<table style="border-collapse:collapse;' + css + '"><tr>' + th('Circle') + th('Risk') + th('Outage hours') + th('Supply complaints') + '</tr>' +
        hiC.map(function (c) { var p = pf.circles[c].p[0]; return '<tr>' + td('<b>' + c + '</b>') + td(p[6]) + td(f(Math.round(p[0] / 60)) + ' (' + f(Math.round(p[1] / 60)) + '–' + f(Math.round(p[2] / 60)) + ')') +
          td(f(p[3]) + ' (' + f(p[4]) + '–' + f(p[5]) + ')') + '</tr>'; }).join('') + '</table>' : '<p style="color:#5d7088">All circles expected near normal.</p>') +
      '<p style="color:#5d7088;margin:6px 0 0">' + (pf.track.days ? 'Track record, last ' + pf.track.days + ' days: outages within range ' + pf.track.outIn + '% of the time, complaints ' + pf.track.cmpIn + '%.' : 'Track record starts after the first day is checked.') +
      (pf.learning ? ' The model is still learning (' + pf.historyDays + ' days of history), so treat the figures as a guide.' : '') + '</p>';
  }
  var warn = SOURCE_ISSUES.length ? '<div style="background:#fdecea;border:1px solid #f5c2bd;border-radius:6px;padding:8px 10px;margin:8px 0;color:#8a1f17"><b>Data check:</b> ' + SOURCE_ISSUES.join('; ') + '</div>' : '';
  var html = '<div style="' + css + '">' +
    '<h2 style="margin:0 0 4px;font-size:17px">Grid and weather, ' + dl + '</h2>' + warn + predHtml +
    '<p style="color:#5d7088;margin:0 0 14px">Each circle is compared with its own normal over the last ' + CFG.NORMAL_WINDOW + ' days.</p>' +
    '<h3 style="color:#b8352b;font-size:14px;margin:14px 0 6px">Beyond weather: check the network</h3>' +
    '<p style="margin:0 0 6px;color:#5d7088">Outages or complaints at ' + CFG.IMPACT_X + '× normal or more without heavy rain or strong gusts.</p>' + table(beyond) +
    '<h3 style="color:#9a6400;font-size:14px;margin:16px 0 6px">Weather-driven</h3>' + table(weather) +
    '<h3 style="color:#1e7fd0;font-size:14px;margin:16px 0 6px">At risk in the next 48 hours</h3>' +
    '<p style="margin:0 0 6px;color:#5d7088">Forecast rain at or above the circle\'s own limit, or gusts of ' + CFG.GUST_KMH + ' km/h or more. Plan crews and materials.</p>' + riskT +
    '<p style="color:#93a3b8;font-size:11.5px;margin-top:16px">Rain and gusts are model estimates averaged over the districts in each circle. For official warnings follow IMD Patna.</p></div>';
  var to = CFG.RECIPIENTS.length ? CFG.RECIPIENTS.join(',') : Session.getEffectiveUser().getEmail();
  MailApp.sendEmail({ to: to, subject: subject, htmlBody: html });
  return 'Sent to ' + to;
}

/* ===================== 5. Prediction ===================== */

var FEATURES = ['Intercept', 'Rain today', 'Rain yesterday', 'Rain 2 days ago', 'Gust above 30 km/h', 'Heat above 35 C', 'Sunday', 'Yesterday level'];
var Z80 = 1.2816;

/* level = log of value / circle normal; 0 means a normal day */
function lvl_(v, n) { return Math.log(Math.max(0.05, v / n)); }

function featRow_(w0, w1, w2, d, prevLevel) {
  var l = function (v) { return Math.log(1 + Math.max(0, v || 0)); };
  var dow = new Date(d + 'T00:00:00Z').getUTCDay();
  return [1, l(w0.rain), l(w1.rain), l(w2.rain), Math.max(0, (w0.gust || 0) - 30) / 10,
    Math.max(0, (w0.tmax || 0) - 35) / 3, dow === 0 ? 1 : 0, prevLevel];
}

/* each circle's normal: median of the last 60 days, using dry days when there are enough */
function normals_(J) {
  var N = {};
  CIRCLES.forEach(function (c) {
    var days = J[c[1]] || {}, ds = Object.keys(days).filter(function (d) { return days[d].tf; }).sort().slice(-60), o = {};
    ['opf', 'sc'].forEach(function (k) {
      var dry = [], all = [];
      ds.forEach(function (d) {
        var x = days[d], p = days[addDays_(d, -1)] || {}; if (x[k] == null) return;
        all.push(x[k]); if (x.rain != null && Math.max(x.rain, p.rain || 0) < 5) dry.push(x[k]);
      });
      o[k] = median_(dry.length >= 7 ? dry : all);
    });
    N[c[1]] = o;
  });
  return N;
}

function trainSet_(J, N, key) {
  var X = [], y = [], days0 = {};
  CIRCLES.forEach(function (c) {
    var days = J[c[1]] || {}, n = N[c[1]] && N[c[1]][key]; if (!n) return;
    Object.keys(days).sort().forEach(function (d) {
      var x = days[d], p = days[addDays_(d, -1)], p2 = days[addDays_(d, -2)] || {};
      if (!x || x[key] == null || !x.tf || !p || p[key] == null || x.rain == null || p.rain == null) return;
      X.push(featRow_(x, p, p2, d, lvl_(p[key], n))); y.push(lvl_(x[key], n)); days0[d] = 1;
    });
  });
  return { X: X, y: y, days: Object.keys(days0).length };
}

function ridge_(X, y, lam) {
  var k = X[0].length, A = [], b = [], i, j;
  for (i = 0; i < k; i++) { A.push(new Array(k).fill(0)); b.push(0); }
  X.forEach(function (r, n) { for (i = 0; i < k; i++) { b[i] += r[i] * y[n]; for (j = 0; j < k; j++) A[i][j] += r[i] * r[j]; } });
  for (i = 1; i < k; i++) A[i][i] += lam;
  // Gaussian elimination with partial pivoting
  for (i = 0; i < k; i++) {
    var p = i; for (j = i + 1; j < k; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j;
    var t = A[i]; A[i] = A[p]; A[p] = t; t = b[i]; b[i] = b[p]; b[p] = t;
    if (Math.abs(A[i][i]) < 1e-12) continue;
    for (j = i + 1; j < k; j++) { var f = A[j][i] / A[i][i]; for (var c = i; c < k; c++) A[j][c] -= f * A[i][c]; b[j] -= f * b[i]; }
  }
  var w = new Array(k).fill(0);
  for (i = k - 1; i >= 0; i--) { var s = b[i]; for (j = i + 1; j < k; j++) s -= A[i][j] * w[j]; w[i] = Math.abs(A[i][i]) < 1e-12 ? 0 : s / A[i][i]; }
  return w;
}
function dot_(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

/* Rain, gusts and heat can only add to outages, never take away. With short history the model can
   learn a negative weight (e.g. "rain 2 days ago" lowers outages, from one storm's recovery day).
   Any such weight is set to 0 and the model is refitted, most negative first. */
var WEATHER_FEATS = [1, 2, 3, 4, 5];
function fitModel_(X, y, lam) {
  var off = {}, w;
  for (var pass = 0; pass <= WEATHER_FEATS.length; pass++) {
    var Xm = X.map(function (r) { return r.map(function (v, i) { return off[i] ? 0 : v; }); });
    w = ridge_(Xm, y, lam);
    var worst = -1;
    WEATHER_FEATS.forEach(function (i) { if (!off[i] && w[i] < 0 && (worst < 0 || w[i] < w[worst])) worst = i; });
    if (worst < 0) break;
    off[worst] = 1;
  }
  return w;
}

function predict_() {
  var J = joined_(), N = normals_(J), stamp = now_(), models = {}, mrows = [];
  ['opf', 'sc'].forEach(function (key) {
    var t = trainSet_(J, N, key), name = key === 'opf' ? 'Outage min per feeder' : 'Supply complaints';
    if (t.X.length < CFG.PRED_MIN_ROWS) { models[key] = null; mrows.push([name, 'Not enough history yet', '', t.X.length, '', stamp]); return; }
    var w = fitModel_(t.X, t.y, CFG.RIDGE), se = 0;
    t.X.forEach(function (r, i) { var e = t.y[i] - dot_(w, r); se += e * e; });
    var sd = Math.max(0.15, Math.sqrt(se / Math.max(1, t.X.length - w.length)));
    models[key] = { w: w, sd: sd, n: t.X.length, days: t.days };
    w.forEach(function (v, i) { mrows.push([name, FEATURES[i], round_(v, 4), t.X.length, round_(sd, 3), stamp]); });
  });
  var ms = sheet_(SH.M);
  if (ms.getLastRow() > 1) ms.getRange(2, 1, ms.getLastRow() - 1, SH.M.head.length).clearContent();
  ms.getRange(2, 1, mrows.length, mrows[0].length).setValues(mrows);

  // weather for a circle and day: recorded history first, else the forecast
  var fc = {};
  rows_(SH.F).forEach(function (r) {
    var d = asYmd_(r[0]); if (!d) return;
    (fc[r[1]] = fc[r[1]] || {})[d] = { rain: r[3] === '' ? null : +r[3], gust: r[4] === '' ? null : +r[4], tmax: r[5] === '' ? null : +r[5] };
  });
  var wxFor = function (c, d) { var x = (J[c] || {})[d]; if (x && x.rain != null) return x; return (fc[c] || {})[d] || {}; };

  var last = '';
  Object.keys(J).forEach(function (c) { Object.keys(J[c]).forEach(function (d) { if (J[c][d].tf && d > last) last = d; }); });
  if (!last) return 'No grid history yet';
  var targets = [addDays_(last, 1), addDays_(last, 2)], rows = [];
  CIRCLES.forEach(function (c) {
    var days = J[c[1]] || {}, n = N[c[1]] || {}, x = days[last]; if (!x || !x.tf) return;
    var prev = { opf: (x.opf != null && n.opf) ? lvl_(x.opf, n.opf) : 0, sc: (x.sc != null && n.sc) ? lvl_(x.sc, n.sc) : 0 };
    targets.forEach(function (t, lead) {
      var w0 = wxFor(c[1], t), w1 = wxFor(c[1], addDays_(t, -1)), w2 = wxFor(c[1], addDays_(t, -2)), out = {};
      ['opf', 'sc'].forEach(function (key) {
        var base = n[key], m = models[key]; if (!base) { out[key] = null; return; }
        var lv = m ? dot_(m.w, featRow_(w0, w1, w2, t, prev[key])) : prev[key] * 0.5;
        var sd = (m ? m.sd : 0.5) * (lead ? 1.25 : 1);
        prev[key] = lv;
        out[key] = { p: base * Math.exp(lv), lo: base * Math.exp(lv - Z80 * sd), hi: base * Math.exp(lv + Z80 * sd), r: Math.exp(lv) };
      });
      var rmax = Math.max(out.opf ? out.opf.r : 0, out.sc ? out.sc.r : 0);
      var risk = rmax >= CFG.IMPACT_X ? 'High' : rmax >= 1.3 ? 'Medium' : 'Normal';
      var tf = x.tf, o = out.opf, s = out.sc;
      rows.push([t, c[1], lead, c[0], stamp,
        o ? Math.round(o.p * tf) : '', o ? Math.round(o.lo * tf) : '', o ? Math.round(o.hi * tf) : '',
        s ? Math.round(s.p) : '', s ? Math.round(s.lo) : '', s ? Math.round(s.hi) : '', risk, '', '', '', '']);
    });
  });
  upsert_(SH.P, rows, 3, [12, 13, 14, 15]);
  var scored = scorePredictions_();
  return 'Predicted ' + targets.join(' and ') + (models.opf ? ' (model, ' + models.opf.n + ' rows)' : ' (carry-over estimate, model still learning)') + '; scored ' + scored;
}

/* fill in what actually happened for earlier predictions */
function scorePredictions_() {
  var J = joined_(), s = sheet_(SH.P), P = rows_(SH.P), n = 0;
  P.forEach(function (r) {
    var d = asYmd_(r[0]); r[0] = d || r[0];
    var x = (J[r[1]] || {})[d]; if (!x || !x.tf) return;
    r[12] = round_(x.om, 0); r[13] = x.sc == null ? '' : x.sc;
    r[14] = r[6] === '' ? '' : (x.om >= +r[6] && x.om <= +r[7] ? 'Yes' : 'No');
    r[15] = (r[9] === '' || x.sc == null) ? '' : (x.sc >= +r[9] && x.sc <= +r[10] ? 'Yes' : 'No');
    n++;
  });
  if (P.length) s.getRange(2, 1, P.length, SH.P.head.length).setValues(P);
  return n + ' rows';
}

/* prediction block for the page and the email */
function predFeed_() {
  var P = rows_(SH.P), M = rows_(SH.M);
  if (!P.length) return null;
  var tfDay = {}, tfLast = {}, lastD = {};
  rows_(SH.G).forEach(function (r) {
    var d = asYmd_(r[0]); if (!d || !+r[3]) return;
    tfDay[d] = (tfDay[d] || 0) + +r[3];
    if (!lastD[r[1]] || d > lastD[r[1]]) { lastD[r[1]] = d; tfLast[r[1]] = +r[3]; }
  });
  var t0 = '';
  P.forEach(function (r) { var d = asYmd_(r[0]); if (+r[2] === 0 && d > t0) t0 = d; });
  var t1 = addDays_(t0, 1), circles = {}, tot = function () { return { om: 0, oml: 0, omh: 0, sc: 0, scl: 0, sch: 0 }; }, T = [tot(), tot()];
  P.forEach(function (r) {
    var d = asYmd_(r[0]), lead = +r[2];
    if (!((lead === 0 && d === t0) || (lead === 1 && d === t1))) return;
    var v = [r[5], r[6], r[7], r[8], r[9], r[10]].map(function (x) { return x === '' ? null : +x; });
    (circles[r[1]] = circles[r[1]] || { dc: r[3], tf: tfLast[r[1]] || null, p: [null, null] }).p[lead] = v.concat([r[11]]);
    var t = T[lead];
    if (v[0] != null) { t.om += v[0]; t.oml += Math.pow(v[0] - v[1], 2); t.omh += Math.pow(v[2] - v[0], 2); }
    if (v[3] != null) { t.sc += v[3]; t.scl += Math.pow(v[3] - v[4], 2); t.sch += Math.pow(v[5] - v[3], 2); }
  });
  var totals = T.map(function (t) {
    return { om: Math.round(t.om), omLo: Math.round(t.om - Math.sqrt(t.oml)), omHi: Math.round(t.om + Math.sqrt(t.omh)),
      sc: Math.round(t.sc), scLo: Math.round(t.sc - Math.sqrt(t.scl)), scHi: Math.round(t.sc + Math.sqrt(t.sch)) };
  });
  // track record: same-day predictions with known results, last 30 days
  var from = addDays_(t0, -31), byDay = {}, oIn = 0, oN = 0, cIn = 0, cN = 0;
  P.forEach(function (r) {
    var d = asYmd_(r[0]); if (+r[2] !== 0 || d < from || r[12] === '') return;
    if (r[14] !== '') { oN++; if (r[14] === 'Yes') oIn++; }
    if (r[15] !== '') { cN++; if (r[15] === 'Yes') cIn++; }
    var b = byDay[d] = byDay[d] || [0, 0, 0, 0];
    b[0] += +r[5] || 0; b[1] += +r[12] || 0; b[2] += +r[8] || 0; b[3] += r[13] === '' ? 0 : +r[13];
  });
  var hist = Object.keys(byDay).sort().map(function (d) { return [d].concat(byDay[d].map(Math.round), [tfDay[d] || null]); });
  var err = function (i, j) { var a = hist.filter(function (h) { return h[j] > 0; }); return a.length ? Math.round(100 * a.reduce(function (s, h) { return s + Math.abs(h[i] - h[j]) / h[j]; }, 0) / a.length) : null; };
  var opfRows = 0; M.forEach(function (r) { if (r[0] === 'Outage min per feeder' && +r[3]) opfRows = +r[3]; });
  var histDays = Math.round(opfRows / CIRCLES.length);
  return {
    targets: [t0, t1], totals: totals, circles: circles,
    track: { days: hist.length, outIn: oN ? Math.round(100 * oIn / oN) : null, cmpIn: cN ? Math.round(100 * cIn / cN) : null,
      outErr: err(1, 2), cmpErr: err(3, 4) },
    hist: hist, learning: histDays < CFG.PRED_TRUSTED_DAYS, historyDays: histDays, usingModel: opfRows >= CFG.PRED_MIN_ROWS
  };
}

/* ===================== 6. Drive archive ===================== */

var AR = {
  C: {name:'Daily Circle',   head:['Date','Discom','Circle','Total Feeders','Feeders With Outage','Interruptions','Outage Min','Avg Outage Min Per Feeder','Feeders Over 4 Hrs','Supply Complaints','Rain mm','Rain Prev Day mm','Max Gust km/h','Max Temp C','Rain Limit mm','Outage x Normal','Complaints x Normal','Status','Saved']},
  D: {name:'Daily Division', head:['Date','Discom','Circle','Division','Total Feeders','Feeders With Outage','Interruptions','Outage Min','Avg Outage Min Per Feeder','Feeders Over 4 Hrs','Saved']},
  F: {name:'Forecast Log',   head:['Issued On','Target Date','Discom','Circle','Rain mm','Max Gust km/h','Max Temp C','Saved']},
  P: {name:'Prediction Log', head:['Made On','Target Date','Lead Days','Discom','Circle','Outage Min','Outage Min Low','Outage Min High','Supply Complaints','Complaints Low','Complaints High','Risk','Actual Outage Min','Actual Complaints','Saved']},
  R: {name:'Read Me',        head:['Item','Detail']}
};
var STATUS_TXT = { W: 'Weather-driven', B: 'Beyond weather', N: 'Normal' };

/** Saves each day to the Drive folder: one master sheet plus one JSON file per day. all=true saves every day in the history. */
function archiveToDrive_(all) {
  var folder = DriveApp.getFolderById(CFG.ARCHIVE_FOLDER_ID), book = archiveBook_();
  var J = joined_(), thr = thresholds_(), stamp = now_(), today = ymd_(new Date());
  var gridDates = {};
  Object.keys(J).forEach(function (c) { Object.keys(J[c]).forEach(function (d) { if (J[c][d].tf) gridDates[d] = 1; }); });
  var dates = Object.keys(gridDates).sort();
  if (!all) dates = dates.slice(-CFG.ARCHIVE_REDO_DAYS);
  if (!dates.length) return 'No grid history yet';
  var divAll = rows_(SH.D), circleOut = [], divOut = [], byDate = {};
  dates.forEach(function (d) { byDate[d] = { circles: [], divisions: [] }; });

  CIRCLES.forEach(function (c) {
    var days = J[c[1]] || {}, t = (thr[c[1]] || {}).thr || CFG.DEFAULT_RAIN_MM;
    dates.forEach(function (d) {
      var x = days[d]; if (!x || !x.tf) return;
      var p = days[addDays_(d, -1)] || {}, st = status_(days, d, t);
      var row = [d, c[0], c[1], x.tf, x.fo, x.itr, round_(x.om, 1), round_(x.om / x.tf, 1), x.o4, x.sc == null ? '' : x.sc,
        x.rain == null ? '' : x.rain, p.rain == null ? '' : p.rain, x.gust == null ? '' : x.gust, x.tmax == null ? '' : x.tmax,
        t, st.ro == null ? '' : st.ro, st.rc == null ? '' : st.rc, STATUS_TXT[st.st], stamp];
      circleOut.push(row);
      byDate[d].circles.push(objOf_(AR.C.head, row));
    });
  });
  divAll.forEach(function (r) {
    var d = asYmd_(r[0]); if (!byDate[d]) return;
    var row = [d, r[1], r[2], r[3], +r[4], +r[5], +r[6], round_(+r[7], 1), +r[4] ? round_(+r[7] / +r[4], 1) : '', +r[8], stamp];
    divOut.push(row);
    byDate[d].divisions.push(objOf_(AR.D.head, row));
  });
  upsert_(AR.C, circleOut, 3, null, book);
  upsert_(AR.D, divOut, 4, null, book);

  // what the forecast and the model said this morning (kept as issued, never overwritten later)
  var fc = rows_(SH.F).map(function (r) { return [today, asYmd_(r[0]), r[2], r[1], r[3], r[4], r[5], stamp]; }).filter(function (r) { return r[1]; });
  upsert_(AR.F, fc, 4, null, book);
  var pr = rows_(SH.P).filter(function (r) { return r[4]; }).map(function (r) {
    return [r[4] instanceof Date ? ymd_(r[4]) : String(r[4]).slice(0, 10), asYmd_(r[0]), +r[2], r[3], r[1], r[5], r[6], r[7], r[8], r[9], r[10], r[11], r[12], r[13], stamp];
  });
  upsert_(AR.P, pr, 5, [12, 13], book);

  // one JSON file per day: JSON/yyyy/yyyy-mm/yyyy-mm-dd.json
  var jsonRoot = sub_(folder, 'JSON'), lastD = dates[dates.length - 1], n = 0;
  dates.forEach(function (d) {
    var data = {
      date: d, savedAt: stamp, timezone: CFG.TZ,
      notes: 'Outage and complaints from the Daily Outage Analytics and 1912 sheets. Rain, gusts and temperature are model estimates averaged over the districts of each circle.',
      circles: byDate[d].circles, divisions: byDate[d].divisions
    };
    if (d === lastD) {
      data.forecastIssuedOn = today;
      data.forecast = fc.map(function (r) { return objOf_(AR.F.head, r); });
      data.predictionsMadeOn = today;
      data.predictions = pr.filter(function (r) { return r[0] === today; }).map(function (r) { return objOf_(AR.P.head, r); });
    }
    var month = sub_(sub_(jsonRoot, d.slice(0, 4)), d.slice(0, 7));
    writeFile_(month, d + '.json', JSON.stringify(data, null, 1), d === lastD || all);
    n++;
  });
  return circleOut.length + ' circle rows, ' + divOut.length + ' division rows, ' + n + ' JSON files';
}

/* the archive tabs live in the main sheet itself; Read Me is written once */
function archiveBook_() {
  var book = book0_();
  ['C', 'D', 'F', 'P'].forEach(function (k) { sheet_(AR[k], book); });
  var r = sheet_(AR.R, book);
  r.getRange(2, 1, 7, 2).setValues([
    ['Daily Circle', 'One row per circle per day: outages, supply complaints, weather and status. Re-saved for the last ' + CFG.ARCHIVE_REDO_DAYS + ' days each morning.'],
    ['Daily Division', 'One row per division per day: outages.'],
    ['Forecast Log', 'The weather forecast for each circle as issued each morning, kept as issued.'],
    ['Prediction Log', 'Each morning\'s prediction, with the actual figures added once known.'],
    ['JSON folder', 'One file per day in the WeatherPrediction Drive folder, a fixed record that is not edited later.'],
    ['Working tabs', 'Weather History, Weather Forecast, Grid History, Division History, Circle Thresholds, Predictions, Model and Run Log are kept by the script.'],
    ['Source', 'Outage figures are read each morning from the Daily Outage Analytics - Bihar sheet (History Divisions tabs) and the 1912 sheet (DB_GEO, DB_META, DB_DAILY).']]);
  return book;
}
function sub_(parent, name) { var it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); }
function writeFile_(folder, name, content, overwrite) {
  var it = folder.getFilesByName(name);
  if (it.hasNext()) { var f = it.next(); if (overwrite) f.setContent(content); return f; }
  return folder.createFile(name, content, 'application/json');
}
function objOf_(head, row) { var o = {}; head.forEach(function (h, i) { if (h !== 'Saved') o[h] = row[i]; }); return o; }

/* ===================== Checks ===================== */

/* Daily cross-check of the two source sheets. Problems go to the Run Log and to the top of the email. */
var SOURCE_ISSUES = [], SOURCE_LATE = false;
function checkSources_() {
  // any problem counts as "not ready": the run waits and retries, and after the last retry runs with a warning
  SOURCE_LATE = true; SOURCE_ISSUES = [];
  var issues = [], div = divisionTotals_(), yest = addDays_(ymd_(new Date()), -1);
  var last = div.dates[div.dates.length - 1];
  if (!last) { SOURCE_ISSUES = ['History Divisions tabs are empty (outage sheet probably refreshing)']; throw new Error(SOURCE_ISSUES[0]); }
  ['SBPDCL', 'NBPDCL'].forEach(function (dc) {
    var l = div.last[dc];
    if (!l) issues.push(dc + ' History Divisions tab missing or empty');
    else if (l < yest) issues.push(dc + ' outage figures end on ' + l + ', yesterday (' + yest + ') is missing');
  });
  var missing = CIRCLES.filter(function (c) { var a = div.byKey[last + '|' + c[1]]; return !a || !a.v[0]; }).map(function (c) { return c[1]; });
  if (missing.length) issues.push('circles missing on ' + last + ': ' + missing.join(', '));
  try {
    var cc = complaints1912_();
    if (cc.cutoff < last) issues.push('1912 complaints only up to ' + cc.cutoff + ', outages up to ' + last);
    if (cc.unknown.length) issues.push('1912 circle names not mapped: ' + cc.unknown.join(', '));
    var noCmp = CIRCLES.filter(function (c) { return cc.byKey[last + '|' + c[1]] == null; }).map(function (c) { return c[1]; });
    if (noCmp.length && cc.cutoff >= last) issues.push('supply complaints missing on ' + last + ' for ' + noCmp.join(', '));
    // circle complaints must add up to the discom totals in DB_DAILY
    var dd = cc.book.getSheetByName('DB_DAILY');
    if (dd && dd.getLastRow() > 1) {
      var ref = {}, diff = [];
      dd.getRange(2, 1, dd.getLastRow() - 1, 4).getValues().forEach(function (r) { if (r[2] === 'Supply Related') ref[asYmd_(r[0]) + '|' + r[1]] = +r[3] || 0; });
      Object.keys(cc.perDiscom).forEach(function (k) { if (k in ref && ref[k] !== cc.perDiscom[k]) diff.push(k.replace('|', ' ') + ' (' + cc.perDiscom[k] + ' against ' + ref[k] + ')'); });
      if (diff.length) issues.push('circle complaints do not add up to the 1912 discom totals: ' + diff.slice(0, 4).join(', ') + (diff.length > 4 ? ' and ' + (diff.length - 4) + ' more' : ''));
    }
  } catch (e) { issues.push('1912 sheet could not be read (' + (e.message || e) + ')'); }
  SOURCE_ISSUES = issues;
  SOURCE_LATE = issues.length > 0;
  if (issues.length) throw new Error(issues.join('; '));
  return 'OK: outages and 1912 complaints to ' + last + ', 20 circles, complaints add up';
}

/** Run by hand to check the six weather models the page uses. Writes one line per model to the Run Log. */
function checkWeatherModels() {
  var models = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'ukmo_seamless', 'meteofrance_seamless', 'jma_seamless'];
  var p = DISTRICTS['Patna'], vars = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'wind_speed_10m_max', 'weather_code'];
  var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + p[0] + '&longitude=' + p[1] + '&timezone=Asia%2FKolkata&forecast_days=7&daily=' + vars.join(',') + '&models=' + models.join(',');
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) { log_('Model check', 'Error', 'Weather service returned ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200)); return; }
  var dly = JSON.parse(res.getContentText()).daily, out = [];
  models.forEach(function (m) {
    var parts = vars.map(function (k) { var a = dly[k + '_' + m]; var n = a ? a.filter(function (x) { return x != null; }).length : 0; return k.replace('_2m', '').replace('_10m', '') + ' ' + n + '/7'; });
    var days = (dly['temperature_2m_max_' + m] || []).filter(function (x) { return x != null; }).length;
    out.push(m + ': ' + (days ? 'OK' : 'NO DATA') + ' (' + parts.join(', ') + ')');
    log_('Model check', days ? 'OK' : 'Error', out[out.length - 1]);
  });
  Logger.log(out.join('\n'));
}

/* ===================== Helpers ===================== */

/* main sheet (this archive sheet): all tabs the script writes */
var BOOK0_ = null;
function book0_() {
  if (!BOOK0_) { try { BOOK0_ = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { BOOK0_ = null; } }
  if (!BOOK0_) BOOK0_ = SpreadsheetApp.openById(CFG.MAIN_SHEET_ID);
  return BOOK0_;
}
/* source sheet (Daily Outage Analytics - Bihar): read only */
var SRC_ = null;
function src_() { return SRC_ || (SRC_ = SpreadsheetApp.openById(CFG.SOURCE_SHEET_ID)); }

/* one time: bring over the grid history and predictions the old script kept in the outage sheet */
function importOldTabs_() {
  var src = src_(), done = [];
  [SH.G, SH.D, SH.P].forEach(function (def) {
    var dst = sheet_(def); if (dst.getLastRow() > 1) return;
    var s = src.getSheetByName(def.name); if (!s || s.getLastRow() < 2) return;
    var v = s.getRange(2, 1, s.getLastRow() - 1, def.head.length).getValues();
    dst.getRange(2, 1, v.length, def.head.length).setValues(v);
    done.push(def.name + ' ' + v.length);
  });
  return done.length ? 'Copied ' + done.join(', ') : 'Nothing to copy';
}


function joined_() {
  var J = {}, get = function (c, d) { J[c] = J[c] || {}; return J[c][d] = J[c][d] || {}; };
  rows_(SH.G).forEach(function (r) {
    var d = asYmd_(r[0]); if (!d) return;
    var x = get(r[1], d), tf = +r[3];
    x.tf = tf; x.fo = +r[4]; x.itr = +r[5]; x.om = +r[6]; x.o4 = +r[7];
    x.sc = r[8] === '' || r[8] == null ? null : +r[8]; x.opf = tf ? +r[6] / tf : null;
  });
  rows_(SH.W).forEach(function (r) {
    var d = asYmd_(r[0]); if (!d) return;
    var x = get(r[1], d); x.rain = r[3] === '' ? null : +r[3]; x.gust = r[4] === '' ? null : +r[4]; x.tmax = r[5] === '' ? null : +r[5];
  });
  return J;
}

function thresholds_() {
  var t = {};
  rows_(SH.T).forEach(function (r) { if (r[0]) t[r[0]] = { thr: +r[2] || CFG.DEFAULT_RAIN_MM, basis: r[3] || 'Default' }; });
  return t;
}

function sheet_(def, book) {
  var ss = book || book0_(), s = ss.getSheetByName(def.name);
  if (!s) {
    s = ss.insertSheet(def.name);
    s.getRange(1, 1, 1, def.head.length).setValues([def.head]).setFontWeight('bold').setBackground('#e8f2fb');
    s.setFrozenRows(1);
  }
  return s;
}

function rows_(def, book) {
  var s = sheet_(def, book), n = s.getLastRow() - 1;
  return n > 0 ? s.getRange(2, 1, n, def.head.length).getValues() : [];
}

/** Insert or replace rows by their first `keyN` columns. keepIfBlank: column indexes kept from the old row when the new value is blank. */
function upsert_(def, rows, keyN, keepIfBlank, book) {
  if (!rows.length) return;
  var s = sheet_(def, book), old = rows_(def, book), idx = {};
  // Sheets turns date text into dates, so every key column is normalised; rows repeated in the sheet are kept once
  var key = function (r) { return r.slice(0, keyN).map(function (v) { return v instanceof Date ? ymd_(v) : (asYmd_(v) || String(v)); }).join('|'); };
  var uniq = [];
  old.forEach(function (r) { var k = key(r); if (k in idx) uniq[idx[k]] = r; else { idx[k] = uniq.length; uniq.push(r); } });
  old = uniq;
  rows.forEach(function (r) {
    var k = key(r);
    if (k in idx) {
      var o = old[idx[k]];
      (keepIfBlank || []).forEach(function (c) { if ((r[c] === '' || r[c] == null) && o[c] !== '') r[c] = o[c]; });
      old[idx[k]] = r;
    } else { idx[k] = old.length; old.push(r); }
  });
  old.sort(function (a, b) { var x = key(a), y = key(b); return x < y ? -1 : x > y ? 1 : 0; });
  var had = s.getLastRow() - 1;
  s.getRange(2, 1, old.length, def.head.length).setValues(old);
  if (had > old.length) s.getRange(old.length + 2, 1, had - old.length, def.head.length).clearContent();
}

function step_(name, fn) {
  try { var m = fn(); log_(name, 'OK', m || ''); }
  catch (e) { log_(name, 'Error', String(e && e.message || e)); }
}
function log_(stepName, status, msg) {
  var s = sheet_(SH.L);
  s.appendRow([now_(), stepName, status, msg]);
  if (s.getLastRow() > 600) s.deleteRows(2, 100);
}

function ymd_(d) { return Utilities.formatDate(d, CFG.TZ, 'yyyy-MM-dd'); }
function now_() { return Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd HH:mm'); }
function asYmd_(v) {
  if (v instanceof Date) return ymd_(v);
  var s = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}
function serialToYmd_(n) {
  n = +n; if (!n || n < 40000) return '';
  return Utilities.formatDate(new Date(Date.UTC(1899, 11, 30) + n * 864e5), 'UTC', 'yyyy-MM-dd');
}
function addDays_(ymd, k) { var t = new Date(ymd + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + k); return Utilities.formatDate(t, 'UTC', 'yyyy-MM-dd'); }
function avg_(a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; }
function median_(a) {
  a = a.filter(function (x) { return x != null && !isNaN(x); }).sort(function (x, y) { return x - y; });
  if (!a.length) return null; var m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function round_(v, p) { var f = Math.pow(10, p); return Math.round(v * f) / f; }
function uniq_(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
