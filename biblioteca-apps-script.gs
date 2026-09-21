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
  if (p.codi !== CODI) return resposta({ ok: false, error: 'codi' });
  if (p.accio === 'importar') return importar(p.url);
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
  url = String(url || '');
  const domini = (url.match(/^https?:\/\/([^\/]+)/i) || [])[1] || '';
  const esCifra = /(^|\.)cifraclub\.com(\.br)?$/i.test(domini);
  const esUG = /(^|\.)ultimate-guitar\.com$/i.test(domini);
  if (!esCifra && !esUG) return resposta({ ok: false, error: 'domini' });
  let html;
  try {
    const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true, headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) Generador de diagrames' } });
    if (r.getResponseCode() !== 200) return resposta({ ok: false, error: 'http' });
    html = r.getContentText('UTF-8');
  } catch (err) { return resposta({ ok: false, error: 'http' }); }

  if (esCifra) {
    const pre = (html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i) || [])[1];
    if (!pre) return resposta({ ok: false, error: 'format' });
    const text = netejarHtml(pre.replace(/<span class="tablatura"[\s\S]*?<\/span>\s*<\/span>/gi, ''));
    const titol = netejarHtml((html.match(/<h1[^>]*class="[^"]*t1[^"]*"[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '');
    const artista = netejarHtml((html.match(/<h2[^>]*class="[^"]*t3[^"]*"[^>]*>([\s\S]*?)<\/h2>/i) || [])[1] || '');
    const to = netejarHtml((html.match(/id="cifra_tom"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) || [])[1] || '');
    let t = titol, a = artista;
    if (!t) {
      const og = netejarHtml((html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i) || [])[1] || '');
      const parts = og.split(' - ');
      t = parts[0] || ''; a = a || parts[1] || '';
    }
    return resposta({ ok: true, titol: t.trim(), artista: a.trim(), to: to.trim(), text: text });
  }

  // Ultimate Guitar: les dades van dins d'un atribut data-content en JSON
  const dades = (html.match(/class="js-store"[^>]*data-content="([^"]*)"/i) || [])[1];
  if (!dades) return resposta({ ok: false, error: 'format' });
  let j;
  try { j = JSON.parse(desferEntitats(dades)); } catch (err) { return resposta({ ok: false, error: 'format' }); }
  const tab = (((j.store || {}).page || {}).data || {});
  const contingut = ((tab.tab_view || {}).wiki_tab || {}).content || '';
  const info = tab.tab || {};
  const text = contingut.replace(/\[\/?tab\]/g, '').replace(/\[ch\]([\s\S]*?)\[\/ch\]/g, '$1').replace(/\r/g, '');
  return resposta({ ok: true, titol: info.song_name || '', artista: info.artist_name || '', to: info.tonality_name || '', text: text });
}
function netejarHtml(s) {
  return desferEntitats(String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));
}
function desferEntitats(s) {
  return String(s || '')
    .replace(/&quot;/g, '"').replace(/&#039;|&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
}
