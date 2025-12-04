const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sensorFile = path.resolve(__dirname, '../../src/catalogs/sensors.ts');
let content = fs.readFileSync(sensorFile, 'utf8');
const start = content.indexOf('export const sensors');
if (start === -1) throw new Error('sensors export not found');
const objectStart = content.indexOf('{', start);
if (objectStart === -1) throw new Error('object start not found');
let depth = 0;
let end = -1;
for (let i = objectStart; i < content.length; i++) {
  const ch = content[i];
  if (ch === '{') depth++;
  else if (ch === '}') {
    depth--;
    if (depth === 0) { end = i; break; }
  }
}
if (end === -1) throw new Error('object end not found');
let objectLiteral = content.slice(objectStart, end + 1);

function removeLines(str, pattern) {
  return str.split('\n').filter((line) => !pattern.test(line)).join('\n');
}

objectLiteral = objectLiteral
  .replace(/\s*\/\/.*$/gm, '')
  .replace(/<[^>]+>/g, '')
  .replace(/as [A-Za-z0-9_\.]+/g, '')
  .replace(/SpaceObjectType\.([A-Z0-9_]+)/g, '"$1"')
  .replace(/Operators\.([A-Z0-9_]+)/g, '"$1"')
  .replace(/ZoomValue\.([A-Za-z0-9_]+)/g, '"$1"')
  .replace(/CommLink\.[A-Za-z0-9_]+/g, 'null');

objectLiteral = removeLines(objectLiteral, /(boresight|changeObjectInterval|url:|beamwidth:|commLinks:|commLinks =|commLinks\s*:)/);
objectLiteral = objectLiteral.replace(/new [A-Za-z0-9_]+\(/g, '');
objectLiteral = objectLiteral.replace(/\}\)/g, '}');
objectLiteral = objectLiteral.replace(/\(\{/g, '{');

const script = `const sensors = ${objectLiteral}; sensors;`;
const result = vm.runInNewContext(script, {}, { filename: 'extractSensors.js' });

const sensorCodes = new Set([
  'EGLAFB','KWAJSPF','GEODDSDGC','GEODDSMAU','GEODDSSOC','KWAJALT','KWAJMMW','KWAJALC','KWAJTDX','MITMIL','RAFASC','GLBII','HOLCBAND','HOLSST',
  'BLEAFB','CODSFS','CAVSFS','CLRSFS','RAFFYL','PITSB',
  'LRDR','COBRADANE','HARTPY','QTRTPY','KURTPY','SHATPY','KCSTPY','SBXRDR',
  'OWLKorea','OWLMongolia','OWLMorocco','OWLIsrael','OWLUSA',
  'LEOCRSR','LEOAZORES','LEOKSR','LEOPFISR','LEOMSR',
  'GRV','TIR','GES','NRC','PDM','TRO','SDT','ZimLAT','ZimSMART','Tromso','Kiruna','Sodankyla','Svalbard',
  'OLED','OLEV','PEC','MISD','MISV','LEKV','ARMV','KALV','BARV','YENV','ORSV','STO','NAK',
  'SHD','HEI','ZHE','XIN','PMO',
  'ROC','MLS','PO','LSO','MAY'
]);

const filtered = {};
for (const [key, value] of Object.entries(result)) {
  if (sensorCodes.has(key)) {
    filtered[key] = value;
  }
}

fs.writeFileSync(path.resolve(__dirname, 'sensors-extracted.json'), JSON.stringify(filtered, null, 2));
console.log('Extracted', Object.keys(filtered).length, 'sensors');
