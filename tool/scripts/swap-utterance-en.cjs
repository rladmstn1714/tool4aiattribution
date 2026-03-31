const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../static/sampledata_try_14');
const currentPath = path.join(dir, 'utterance_list.json');
const backupPath = path.join(dir, 'utterance_list_ko.json');

// 1. Backup: copy current (KO in utterance, EN in utterance_en) to utterance_list_ko.json
const current = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
fs.writeFileSync(backupPath, JSON.stringify(current, null, 0), 'utf8');
console.log('Backed up to utterance_list_ko.json');

// 2. Replace utterance_list.json with English version: utterance = utterance_en, keep utterance_ko
current.utterances = current.utterances.map((u) => {
  const ko = u.utterance;
  const en = u.utterance_en != null ? u.utterance_en : u.utterance;
  const out = { turn_id: u.turn_id, speaker: u.speaker, utterance: en };
  if (ko && ko !== en) out.utterance_ko = ko;
  return out;
});
fs.writeFileSync(currentPath, JSON.stringify(current, null, 0), 'utf8');
console.log('Replaced utterance_list.json with English version (utterance_ko kept where different)');
