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
