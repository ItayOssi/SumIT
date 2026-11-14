'use strict';
// The student's institution: which Moodle and personal portal the app talks to. The list lives in
// src/web/institutions.js (shared with the page); this keeps the one in use, so every module asks the same place.

const path = require('path');
const platform = require('./platform');
const I = require(path.join(platform.WebDir, 'institutions.js'));

let current = I.resolve({});

module.exports = {
  I,
  // settings: { institute, moodleUrl, portalUrl }
  set(settings) { current = I.resolve(settings || {}); return current; },
  get current() { return current; },
  moodleBase() { return current.moodle; },
  isMoodleUrl(url) { return I.isMoodleUrl(current, url); },
  isPortalUrl(url) { return I.isPortalUrl(current, url); },
};
