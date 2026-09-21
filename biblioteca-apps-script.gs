/**
 * Biblioteca compartida del Generador de Diagrames (ROCKIN)
 * ---------------------------------------------------------
 * Aquest script desa i llegeix les cançons a una carpeta de Google Drive.
 *
 * 1. Enganxa aquí l'identificador de la carpeta (el tros final de l'adreça
 *    de la carpeta a Drive: drive.google.com/drive/folders/XXXXXXXX → XXXXXXXX).
 * 2. Tria un codi per al professorat. Només qui el sàpiga podrà compartir
 *    i veure cançons des de l'eina.
 */
const CARPETA_ID = 'ENGANXA_AQUI_LID_DE_LA_CARPETA';
const CODI = 'rockin';

function doGet(e) {
  const p = e.parameter || {};
  if (p.accio === 'importar') return importar(p.url);   // no toca el Drive: no cal el codi
  if (p.codi !== CODI) return resposta({ ok: false, error: 'codi' });
  const carpeta = DriveApp.getFolderById(CARPETA_ID);

  // Obrir una cançó concreta
  if (p.id) {
    const f = DriveApp.getFileById(p.id);
    if (!esDeLaCarpeta(f, carpeta)) return resposta({ ok: false, error: 'no-trobada' });
    return resposta({ ok: true, canco: JSON.parse(f.getBlob().getDataAsString('UTF-8')) });
  }

  // Llista de totes les cançons
  const llista = [];
  const fitxers = carpeta.getFiles();
  while (fitxers.hasNext()) {
    const f = fitxers.next();
    if (!/\.json$/i.test(f.getName())) continue;
    let info = {};
    try { info = JSON.parse(f.getDescription() || '{}'); } catch (err) { }
    llista.push({ id: f.getId(), nom: f.getName().replace(/\.json$/i, ''), data: f.getLastUpdated().toISOString(), ...info });
  }
  llista.sort((a, b) => b.data.localeCompare(a.data));
  return resposta({ ok: true, llista: llista });
}

function doPost(e) {
  let dades;
  try { dades = JSON.parse(e.postData.contents); } catch (err) { return resposta({ ok: false, error: 'format' }); }
  if (dades.codi !== CODI) return resposta({ ok: false, error: 'codi' });
  if (!dades.canco || !dades.nom) return resposta({ ok: false, error: 'format' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const carpeta = DriveApp.getFolderById(CARPETA_ID);
    const nom = String(dades.nom).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120) + '.json';
    const contingut = JSON.stringify(dades.canco);
    const existents = carpeta.getFilesByName(nom);
    let f;
    if (existents.hasNext()) {
      if (!dades.sobreescriure) return resposta({ ok: false, error: 'existeix' });
      f = existents.next();
      f.setContent(contingut);
    } else {
      f = carpeta.createFile(nom, contingut, 'application/json');
    }
    f.setDescription(JSON.stringify(dades.info || {}));
    return resposta({ ok: true, id: f.getId() });
  } finally {
    lock.releaseLock();
  }
}

function esDeLaCarpeta(fitxer, carpeta) {
  const pares = fitxer.getParents();
  while (pares.hasNext()) if (pares.next().getId() === carpeta.getId()) return true;
  return false;
}

function resposta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}


/* ---------------------------------------------------------
   Importar acords i lletra d'una pàgina web
   (Cifra Club i Ultimate Guitar). Torna el text en brut;
   l'eina ja s'encarrega d'entendre'l.
   --------------------------------------------------------- */
function importar(url) {
  url = String(url || '').trim();
  const domini = (url.match(/^https?:\/\/([^\/]+)/i) || [])[1] || '';
  const esCifra = /(^|\.)cifraclub\.com(\.br)?$/i.test(domini);
  const esUG = /(^|\.)ultimate-guitar\.com$/i.test(domini);
  if (!esCifra && !esUG) return resposta({ ok: false, error: 'domini' });

  // 1r intent: directament, fent-nos passar per un navegador normal
  const directe = descarregar(url);
  if (directe.ok) {
    const r = esCifra ? llegirCifraClub(directe.html) : llegirUG(directe.html);
    if (r) return resposta(Object.assign({ ok: true, via: 'directe' }, r));
  }
  // 2n intent: a través d'un lector públic (r.jina.ai) que torna el text de la pàgina
  const lector = descarregar('https://r.jina.ai/' + url, { 'X-Return-Format': 'text' });
  if (lector.ok && lector.html.length > 200) {
    return resposta({ ok: true, via: 'lector', titol: '', artista: '', to: '', text: textDelLector(lector.html) });
  }
  return resposta({ ok: false, error: 'http', detall: 'directe ' + directe.codi + ' · lector ' + lector.codi });
}
function descarregar(url, extra) {
  try {
    const r = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true, followRedirects: true,
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ca,es;q=0.9,pt;q=0.8,en;q=0.7'
      }, extra || {})
    });
    const codi = r.getResponseCode();
    return { ok: codi === 200, codi: codi, html: codi === 200 ? r.getContentText('UTF-8') : '' };
  } catch (err) { return { ok: false, codi: 'error: ' + err.message, html: '' }; }
}
function llegirCifraClub(html) {
  const pre = (html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i) || [])[1];
  if (!pre) return null;
  const text = netejarHtml(pre.replace(/<span class="tablatura"[\s\S]*?<\/span>\s*<\/span>/gi, ''));
  let titol = netejarHtml((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '');
  let artista = netejarHtml((html.match(/<h2[^>]*class="[^"]*t3[^"]*"[^>]*>([\s\S]*?)<\/h2>/i) || [])[1] || '');
  const to = netejarHtml((html.match(/id="cifra_tom"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) || [])[1] || '');
  if (!titol) {
    const og = netejarHtml((html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i) || [])[1] || '');
    const parts = og.split(' - ');
    titol = parts[0] || ''; artista = artista || parts[1] || '';
  }
  const capo = (netejarHtml(html).match(/Capotraste\s+na\s+(\d{1,2})/i) || [])[1] || '';
  return { titol: titol.trim(), artista: artista.trim(), to: to.trim(), capo: capo, text: text };
}
function llegirUG(html) {
  const dades = (html.match(/class="js-store"[^>]*data-content="([^"]*)"/i) || [])[1];
  if (!dades) return null;
  let j;
  try { j = JSON.parse(desferEntitats(dades)); } catch (err) { return null; }
  const tab = (((j.store || {}).page || {}).data || {});
  const contingut = ((tab.tab_view || {}).wiki_tab || {}).content || '';
  if (!contingut) return null;
  const info = tab.tab || {};
  const text = contingut.replace(/\[\/?tab\]/g, '').replace(/\[ch\]([\s\S]*?)\[\/ch\]/g, '$1').replace(/\r/g, '');
  return { titol: info.song_name || '', artista: info.artist_name || '', to: info.tonality_name || '', capo: String(((tab.tab_view || {}).meta || {}).capo || ''), text: text };
}
function textDelLector(t) {
  // Si hi ha blocs de codi (```), el xifrat sol ser el més llarg
  const blocs = t.split('```').filter((b, i) => i % 2 === 1);
  if (blocs.length) return blocs.sort((a, b) => b.length - a.length)[0].replace(/^[a-z]*\n/, '');
  return t;
}
function netejarHtml(s) {
  return desferEntitats(String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));
}
function desferEntitats(s) {
  return String(s || '')
    .replace(/&quot;/g, '"').replace(/&#039;|&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
}

// Executa aquesta funció una vegada des de l'editor per donar permís a l'script per llegir pàgines web
function autoritzar() {
  UrlFetchApp.fetch('https://www.google.com');
}
