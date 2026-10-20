'use strict';
/* Guscio del browser. Non contiene regole né calcoli: tutta l'applicazione gira nella funzione "planner"
   di Supabase. Il guscio:
   - inoltra a "planner" clic, tasti, trascinamenti e valori dei campi, una richiesta alla volta;
   - applica i pezzi di pagina che riceve (morphdom);
   - gestisce solo ciò che riguarda lo schermo: posizione del riquadro, sagoma durante i trascinamenti,
     suggerimenti al passaggio del mouse, download e scelta di file (con estrazione del testo dei PDF). */
(() => {
const VOLATILI = new Set(['value', 'checked', 'selected', 'open', 'style']);
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const PDFJS_SRI = { 'pdf.min.js': 'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e', 'pdf.worker.min.js': 'sha384-SnzOobpRMLXZ52iJvZm/C0fYw0OQemTXzTjIsdsfMcrCtCEe9qgzxTd3RSklO5x2' };
// stato della conversazione con "planner": vista di partenza, azioni nella finestra aperta, avviso "Annulla"
const C = { voce: null, uiBase: null, catena: [], imp: null, annulla: null, impronte: {}, primo: true, versione: 0 };
let ultimoClic = { x: 200, y: 200 }, popPos = null, mangiaClic = false;
window.__messaggi = 0; window.__inVolo = 0;

/* ---------------- indirizzi degli elementi: radice (data-k), firma, numero d'ordine ---------------- */
// un class vuoto non conta (come sul server)
const firma = el => el.tagName.toLowerCase() + '|' + [...el.attributes].filter(a => !VOLATILI.has(a.name) && !(a.name === 'class' && !a.value.trim())).map(a => a.name + '=' + a.value).sort().join('|');
const radiceDi = el => { let r = el; while (r && r.parentElement && r.parentElement !== document.body) r = r.parentElement; return r && r.parentElement === document.body && r.dataset.k ? r : null; };
function indirizzo(el) {
  const r = radiceDi(el); if (!r) return null;
  const f = firma(el), uguali = r === el ? [el] : [...r.querySelectorAll(el.tagName.toLowerCase())].filter(x => firma(x) === f);
  return { k: r.dataset.k, f, n: Math.max(0, uguali.indexOf(el)) };
}
function trova(ind) {
  if (!ind) return null;
  const r = document.querySelector('body > [data-k="' + CSS.escape(ind.k) + '"]'); if (!r) return null;
  if (firma(r) === ind.f && !ind.n) return r;
  return [...r.querySelectorAll(ind.f.split('|')[0])].filter(x => firma(x) === ind.f)[ind.n || 0] || null;
}
// valore di ogni campo al momento dell'ultimo invio: se l'utente scrive ancora mentre la risposta è in viaggio,
// quella risposta non deve riportare il campo indietro
const inviato = new WeakMap();
const statoCampo = c => (c.type === 'checkbox' || c.type === 'radio' ? c.checked : c.value);
const campo = c => [indirizzo(c), c.value, c.type === 'checkbox' || c.type === 'radio' ? c.checked : null];
const eCampo = el => el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && el.type !== 'file';
// il campo ha un valore diverso da quello disegnato dal server (cioè l'utente l'ha cambiato)
const diversoDalServer = c => c.type === 'checkbox' || c.type === 'radio' ? c.checked !== c.hasAttribute('checked')
  : c.tagName === 'SELECT' ? c.value !== ((c.querySelector('option[selected]') || c.querySelector('option') || {}).value ?? '')
  : c.value !== (c.getAttribute('value') ?? (c.tagName === 'TEXTAREA' ? c.defaultValue : ''));
/** I campi della parte di pagina (radice) in cui avviene l'azione: quello dell'azione e quelli cambiati dall'utente.
 *  Gli altri il server li conosce già: rimandarli riporterebbe indietro valori che ha appena ricalcolato. */
function campiDi(r, proprio) {
  const out = [];
  for (const c of r.querySelectorAll('input, select, textarea')) { if (c.type === 'file' || (c !== proprio && !diversoDalServer(c))) continue; inviato.set(c, statoCampo(c)); out.push(campo(c)); }
  return out;
}
function evento(tipo, el, extra = {}) {
  const ind = el === document.body ? { k: 'body' } : indirizzo(el); if (!ind) return;
  // prima di ogni altra azione partono le scritture ancora in attesa (es. ore che ricalcolano altri campi)
  if (tipo !== 'input') svuotaInput();
  // i valori dei campi si leggono quando la richiesta parte: già aggiornati dalle risposte precedenti
  invia(Object.assign({ t: tipo, ind, _radice: el === document.body ? null : ind.k, _el: el }, extra));
}

/* ---------------- richieste a "planner": una alla volta, a gruppi ----------------
   Le azioni fatte mentre una richiesta è in viaggio aspettano e partono tutte insieme nella successiva:
   anche con la rete lenta i viaggi restano pochi. L'anteprima del trascinamento parte subito, a parte. */
let inCoda = [], lavoro = null, anteprime = 0;
const occupato = () => !!lavoro || inCoda.length > 0 || anteprime > 0;
// in attesa: richieste in coda o in corso, più le scritture non ancora inviate (usato anche dalle prove automatiche)
const aggiornaAttesa = () => { window.__inVolo = (lavoro ? 1 : 0) + inCoda.length + anteprime + attesaInput.size; };
function invia(ev) {
  if (ev.t === 'anteprima') { anteprime++; aggiornaAttesa(); return richiesta([ev]).finally(() => { anteprime--; aggiornaAttesa(); }); }
  return new Promise(ok => { inCoda.push({ ev, ok }); aggiornaAttesa(); lavora(); });
}
function lavora() {
  if (lavoro) return;
  lavoro = (async () => {
    while (inCoda.length) {
      const gruppo = inCoda.splice(0);
      try { await richiesta(gruppo.map(x => x.ev)); } catch (e) { console.error(e); }
      gruppo.forEach(x => x.ok());
    }
    lavoro = null; aggiornaAttesa();
  })();
  aggiornaAttesa();
}
const barra = (() => { const b = document.createElement('div'); b.id = 'avanzamento'; b.setAttribute('aria-hidden', 'true'); document.body.appendChild(b); return b; })();
async function richiesta(eventi) {
  // l'ultima azione porta i campi cambiati dall'utente; le precedenti solo il proprio campo,
  // l'unico che il loro gestore legge: richieste leggere anche quando le azioni partono a gruppi
  eventi.forEach((ev, i) => {
    if (!('_radice' in ev)) return;
    const r = ev._radice && document.querySelector('body > [data-k="' + CSS.escape(ev._radice) + '"]');
    ev.campi = !r ? [] : i === eventi.length - 1 ? campiDi(r, ev._el) : eCampo(ev._el) ? [campo(ev._el)] : [];
    if (eCampo(ev._el)) inviato.set(ev._el, statoCampo(ev._el));
    delete ev._radice; delete ev._el;
  });
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { location.reload(); return; }
  // se il server ci mette più di un attimo: barra di avanzamento in alto e puntatore di attesa
  const lento = setTimeout(() => { document.body.classList.add('attesa'); barra.classList.add('on'); }, 300);
  try {
    let vista = null; try { vista = JSON.parse(sessionStorage.getItem('vista') || 'null'); } catch (e) { }
    const prefs = {}; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^planning-vista/.test(k)) prefs[k] = localStorage.getItem(k); } } catch (e) { }
    const corpo = { carrozzeria_id: C.voce.id, uiBase: C.uiBase || (C.primo && vista) || null, catena: C.catena, eventi, imp: C.imp, annulla: C.annulla,
      impronte: C.impronte, primo: C.primo, prefs, larghezza: innerWidth, altezza: innerHeight, ora: window.__ORA_FINTA || null };
    const r = await fetch(window.CONFIG.url + '/functions/v1/planner', { method: 'POST', body: JSON.stringify(corpo),
      headers: { 'Content-Type': 'application/json', apikey: window.CONFIG.chiave, Authorization: 'Bearer ' + session.access_token } });
    const d = await r.json().catch(() => ({ errore: 'Risposta non leggibile dal server.' }));
    if (eventi[0].t === 'anteprima') return d.anteprima;
    if (!r.ok || d.errore) { mostraErrore(d.errore || 'Operazione non riuscita (' + r.status + ').'); return; }
    C.primo = false; C.versione = Math.max(C.versione, d.versione || 0); C.uiBase = d.uiBase; C.catena = d.catena || []; C.imp = d.imp; C.annulla = d.annulla || null;
    try { sessionStorage.setItem('vista', JSON.stringify({ tab: d.ui.tab, view: d.ui.view, weekStart: d.ui.weekStart, month: d.ui.month })); } catch (e) { }
    applica(d);
  } catch (e) { mostraErrore('Connessione con il server non riuscita: riprova.'); }
  finally {
    clearTimeout(lento); window.__messaggi++;
    if (!(inCoda.length || (lavoro && eventi[0].t === 'anteprima'))) { document.body.classList.remove('attesa'); barra.classList.remove('on'); }
  }
}

/* ---------------- applicazione dei pezzi di pagina ---------------- */
let ancoraggio = null; // un pulsante che deve restare fermo sotto il mouse durante il ridisegno
function applica(m) {
  if (m.radice) {
    const h = document.documentElement;
    if (m.radice.style) h.setAttribute('style', m.radice.style); else h.removeAttribute('style');
    if (m.radice.fw) h.dataset.fw = m.radice.fw; else delete h.dataset.fw;
    if (m.radice.titolo) document.title = m.radice.titolo;
  }
  for (const p of m.parti || []) aggiornaParte(p);
  if (m.prefs) for (const [k, v] of Object.entries(m.prefs)) try { localStorage.setItem(k, v); } catch (e) { }
  if (m.fuoco) { const el = trova(m.fuoco); if (el) { el.focus(); if (m.fuoco.seleziona && el.select) el.select(); } }
  if (m.scorri) { const el = trova(m.scorri); if (el) el.scrollIntoView({ block: m.scorri.blocco || 'start', inline: 'nearest' }); }
  if (m.scarica) scarica(m.scarica);
  if (m.scegliFile) scegliFile(m.scegliFile);
  if (m.ricarica) { try { history.replaceState(null, '', location.pathname + location.search); sessionStorage.removeItem('vista'); } catch (e) { } location.reload(); }
  if (ancoraggio && (m.parti || []).some(p => p.k === 'main')) {
    const a = ancoraggio; ancoraggio = null; const el = trova(a.ind);
    if (el) window.scrollTo(0, scrollY + (el.getBoundingClientRect().top - a.top));
  }
}
function aggiornaParte(p) {
  let el = document.querySelector('body > [data-k="' + CSS.escape(p.k) + '"]');
  if (p.rimosso) { if (el) { if (el.tagName === 'DIALOG' && el.open) el.close(); el.remove(); } delete C.impronte[p.k]; return; }
  C.impronte[p.k] = p.h;
  if (!el) {
    el = document.createElement(p.tag);
    const s = [...document.body.children].find(x => x.tagName === 'SCRIPT');
    document.body.insertBefore(el, s || null);
  }
  const eraNascosto = el.hidden;
  for (const a of [...el.attributes]) if (!(a.name in p.attrs) && !(a.name === 'style' && el.id === 'pop') && a.name !== 'open') el.removeAttribute(a.name);
  for (const [k, v] of Object.entries(p.attrs)) { if (k === 'open' || (k === 'style' && el.id === 'pop')) continue; if (el.getAttribute(k) !== v) el.setAttribute(k, v); }
  // valori dei campi: si aggiornano solo se il server li ha cambiati davvero (per esempio ore ricalcolate);
  // altrimenti resta quello che l'utente ha scritto, anche se nel frattempo è arrivata la risposta a una richiesta precedente
  morphdom(el, '<div>' + p.html + '</div>', {
    childrenOnly: true,
    onBeforeElUpdated: (da, a) => {
      // il valore dell'utente resta (il nuovo elemento lo riceve, così morphdom non lo tocca) se:
      // - l'utente ha cambiato il campo dopo l'ultimo invio (la risposta porta un valore ormai vecchio), oppure
      // - il server non ha cambiato il campo. Altrimenti vale il valore del server (es. ore ricalcolate).
      const toccato = inviato.has(da) && inviato.get(da) !== statoCampo(da);
      let tieni = true;
      if (da.tagName === 'INPUT' && (da.type === 'checkbox' || da.type === 'radio')) { tieni = toccato || da.hasAttribute('checked') === a.hasAttribute('checked'); if (tieni) a.checked = da.checked; }
      else if (da.tagName === 'INPUT' || da.tagName === 'TEXTAREA') { tieni = toccato || da.getAttribute('value') === a.getAttribute('value'); if (tieni) a.value = da.value; }
      else if (da.tagName === 'SELECT') { const v = s => (s.querySelector('option[selected]') || {}).value; tieni = toccato || v(da) === v(a); if (tieni) a.value = da.value; }
      // il campo ora mostra il valore del server (es. ore convertite in minuti): non è una scrittura dell'utente
      if (!tieni) inviato.delete(da);
      if (da.tagName === 'DETAILS') da.open = a.hasAttribute('open');
      return true;
    }
  });
  if (el.tagName === 'DIALOG') {
    ascoltaDialogo(el);
    if ('open' in p.attrs && !el.open) {
      // finestra che si apre: i campi ripartono dai valori del server, non da quanto scritto in un'apertura precedente
      for (const c of el.querySelectorAll('input, textarea, select')) {
        if (c.type === 'checkbox' || c.type === 'radio') c.checked = c.hasAttribute('checked');
        else if (c.tagName === 'SELECT') { const o = c.querySelector('option[selected]') || c.querySelector('option'); if (o) c.value = o.value; }
        else if (c.type !== 'file') c.value = c.getAttribute('value') ?? '';
      }
      el.showModal();
    }
    else if (!('open' in p.attrs) && el.open) el.close();
  }
  if (el.id === 'pop' && !el.hidden && (eraNascosto || !el.style.left)) posizionaPop();
}
const ascoltati = new WeakSet(); // niente attributi aggiunti: la firma degli elementi deve restare uguale a quella del server
function ascoltaDialogo(d) {
  if (ascoltati.has(d)) return; ascoltati.add(d);
  // Esc chiude le finestre: lo decide il server, che gestisce le conseguenze (conferme, annullamenti)
  d.addEventListener('cancel', e => { e.preventDefault(); evento('chiudi', d); });
}
function mostraErrore(t) { const s = document.getElementById('saveState'); if (s) { s.textContent = t; s.classList.add('bad'); } else alert(t); }

/* ---------------- riquadro: posizione e spostamento (solo schermo) ---------------- */
function posizionaPop() {
  const pop = document.getElementById('pop'); if (!pop || pop.hidden) return;
  const z = parseFloat(pop.style.zoom) || 1, pw = pop.offsetWidth * z, ph = pop.offsetHeight * z;
  let { left, top } = popPos || { left: ultimoClic.x + 8, top: ultimoClic.y + 8 };
  left = Math.max(8, Math.min(left, innerWidth - pw - 8)); top = Math.max(8, Math.min(top, innerHeight - ph - 8));
  pop.style.left = left / z + 'px'; pop.style.top = top / z + 'px';
}
let spostaRiquadro = null;
document.addEventListener('pointerdown', ev => {
  const h = ev.target.closest('#pop .carhead');
  if (!h || ev.button !== 0 || ev.target.closest('button, input, select, a')) return;
  const r = document.getElementById('pop').getBoundingClientRect();
  spostaRiquadro = { id: ev.pointerId, dx: ev.clientX - r.left, dy: ev.clientY - r.top, on: false, x: ev.clientX, y: ev.clientY };
  try { h.setPointerCapture(ev.pointerId); } catch (e) { }
  ev.preventDefault();
});
document.addEventListener('pointermove', ev => {
  if (!spostaRiquadro || ev.pointerId !== spostaRiquadro.id) return;
  if (!spostaRiquadro.on) { if (Math.hypot(ev.clientX - spostaRiquadro.x, ev.clientY - spostaRiquadro.y) < 3) return; spostaRiquadro.on = true; document.getElementById('pop').classList.add('moving'); }
  popPos = { left: ev.clientX - spostaRiquadro.dx, top: ev.clientY - spostaRiquadro.dy }; posizionaPop();
});
const fineSpostamento = () => { if (!spostaRiquadro) return; const d = spostaRiquadro; spostaRiquadro = null; document.getElementById('pop').classList.remove('moving'); if (d.on) { mangiaClic = true; setTimeout(() => { mangiaClic = false; }, 0); } };
document.addEventListener('pointerup', fineSpostamento); document.addEventListener('pointercancel', fineSpostamento);
document.addEventListener('dblclick', ev => { if (ev.target.closest('#pop .carhead') && !ev.target.closest('button')) { popPos = null; posizionaPop(); } });
addEventListener('resize', posizionaPop);

/* ---------------- trascinamenti: sagoma sullo schermo, decisione sul server al rilascio ---------------- */
let tr = null;
const SORGENTI = '.week .job[data-drag], .pcard[data-pcar]';
const evidenzia = (c, si) => { if (c) c.style.outline = si ? '2px dashed var(--tape)' : ''; };
document.addEventListener('pointerdown', ev => {
  if (ev.button !== 0 || ev.pointerType === 'touch' || spostaRiquadro) return;
  const s = ev.target.closest(SORGENTI); if (!s || !radiceDi(s)) return;
  if (s.matches('.pcard') && ev.target.closest('button, input, select, a')) return;
  tr = { s, giu: indirizzo(ev.target), x: ev.clientX, y: ev.clientY, on: false, sopra: null, sagoma: null };
});
// testo originale della riga dell'anteprima: torna com'era quando si lascia il giorno o si annulla il trascinamento
const testoPv = new WeakMap();
const ripristinaPv = c => { const pv = c && c.querySelector && c.querySelector('.pvw'); if (pv && testoPv.has(pv)) { pv.textContent = testoPv.get(pv); testoPv.delete(pv); } };
document.addEventListener('pointermove', ev => {
  if (!tr) return;
  if (!tr.on) {
    if (Math.hypot(ev.clientX - tr.x, ev.clientY - tr.y) < 6) return;
    tr.on = true;
    const g = tr.s.cloneNode(true); g.removeAttribute('data-k');
    if (tr.s.matches('.pcard')) { g.className = 'pghost'; const t = tr.s.querySelector('.plate'); g.innerHTML = t ? t.outerHTML : ''; }
    else { g.classList.add('ghost'); g.style.width = tr.s.offsetWidth + 'px'; }
    document.body.appendChild(g); tr.sagoma = g; tr.s.style.opacity = '.45'; document.body.classList.add('dragmode');
  }
  tr.sagoma.style.left = ev.clientX + 10 + 'px'; tr.sagoma.style.top = ev.clientY + 6 + 'px';
  const t = document.elementFromPoint(ev.clientX, ev.clientY), c = t && t.closest('[data-day], [data-pday]');
  if (c !== tr.sopra) {
    evidenzia(tr.sopra, false); ripristinaPv(tr.sopra); tr.sopra = c; evidenzia(c, true);
    // parcheggio: la fine stimata per quel giorno la calcola il server
    const pv = c && c.matches('[data-pday]') && c.querySelector('.pvw');
    if (pv && tr.s.matches('.pcard')) {
      const mio = tr; if (!testoPv.has(pv)) testoPv.set(pv, pv.textContent); pv.textContent = 'Calcolo…';
      invia({ t: 'anteprima', ind: tr.giu, sotto: indirizzo(c) }).then(x => { if (tr === mio && mio.sopra === c) pv.textContent = x || ''; });
    }
  }
  if (ev.clientY < 100) scrollBy(0, -14); else if (ev.clientY > innerHeight - 100) scrollBy(0, 14);
  ev.preventDefault();
});
function fineTrascinamento(ev, annulla) {
  if (!tr) return;
  const t = tr; tr = null;
  if (t.sagoma) t.sagoma.remove(); t.s.style.opacity = ''; evidenzia(t.sopra, false); ripristinaPv(t.sopra); document.body.classList.remove('dragmode');
  if (!t.on) return;
  mangiaClic = true; setTimeout(() => { mangiaClic = false; }, 0);
  if (!annulla && t.sopra) invia({ t: 'trascina', ind: t.giu, sotto: indirizzo(t.sopra) });
}
document.addEventListener('pointerup', ev => fineTrascinamento(ev, false));
document.addEventListener('pointercancel', ev => fineTrascinamento(ev, true));

/* ---------------- clic, campi, tasti ---------------- */
document.addEventListener('click', ev => {
  if (mangiaClic) { mangiaClic = false; ev.preventDefault(); return; }
  if (!radiceDi(ev.target) || ev.target.closest('#landing, #dlgUtenti')) return;
  const campo = ev.target.closest('input, textarea, select, label'), pop = document.getElementById('pop');
  if (campo && pop.hidden && !(campo.tagName === 'INPUT' && /^(button|submit|reset|checkbox|radio)$/.test(campo.type))) return;
  ultimoClic = { x: ev.clientX, y: ev.clientY };
  const b = ev.target.closest('[data-a="collapseall"], [data-a="daycollapse"]');
  ancoraggio = b ? { ind: indirizzo(b), top: b.getBoundingClientRect().top } : null;
  if (ev.target.closest('a[href]')) ev.preventDefault();
  evento('click', ev.target, { clientX: ev.clientX, clientY: ev.clientY, button: ev.button });
});
document.addEventListener('change', ev => { if (radiceDi(ev.target) && ev.target.type !== 'file') evento('change', ev.target); });
const attesaInput = new Map();
function svuotaInput() { for (const [el, t] of [...attesaInput]) { clearTimeout(t); attesaInput.delete(el); if (el.isConnected) evento('input', el); } aggiornaAttesa(); }
document.addEventListener('input', ev => {
  const el = ev.target; if (!radiceDi(el) || el.type === 'file') return;
  clearTimeout(attesaInput.get(el)); attesaInput.set(el, setTimeout(() => { attesaInput.delete(el); evento('input', el); aggiornaAttesa(); }, 200)); aggiornaAttesa();
});
document.addEventListener('toggle', ev => { if (radiceDi(ev.target) && ev.target.tagName === 'DETAILS') evento('toggle', ev.target, { aperto: ev.target.open }); }, true);
document.addEventListener('keydown', ev => {
  if (!C.voce || document.getElementById('landing') || (ev.target.closest && ev.target.closest('#dlgUtenti'))) return;
  const t = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body;
  const scrive = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  const annulla = (ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z';
  if (ev.key === 'F12') ev.preventDefault();
  if (scrive && !['Enter', 'Escape', 'F12'].includes(ev.key) && !annulla) return;
  if (['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(ev.key)) return;
  if (t.closest && t.closest('.tabs button') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) ev.preventDefault();
  if (t.matches && t.matches('tr[data-car]') && (ev.key === 'Enter' || ev.key === ' ')) ev.preventDefault();
  if (annulla && !scrive) ev.preventDefault();
  if (ev.key === 'Enter' && t.id === 'nwork') ev.preventDefault();
  evento('keydown', t === document.body || !radiceDi(t) ? document.body : t,
    { key: ev.key, code: ev.code, ctrlKey: ev.ctrlKey, metaKey: ev.metaKey, shiftKey: ev.shiftKey, altKey: ev.altKey });
});

/* ---------------- file: scelta, estrazione del testo, download ---------------- */
function scarica({ nome, tipo, testo }) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([testo], { type: tipo || 'application/octet-stream' }));
  a.download = nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function caricaScript(src) {
  return new Promise((ok, ko) => { const s = document.createElement('script'); s.src = src; const f = src.split('/').pop(); if (PDFJS_SRI[f]) { s.integrity = PDFJS_SRI[f]; s.crossOrigin = 'anonymous'; } s.onload = ok; s.onerror = () => ko(new Error('caricamento')); document.head.appendChild(s); });
}
async function pdfjs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await caricaScript(PDFJS + 'pdf.min.js'); await caricaScript(PDFJS + 'pdf.worker.min.js');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
  return window.pdfjsLib;
}
const b64 = b => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = ko; r.readAsDataURL(b); });
/** Testo di un PDF (o, se è una scansione, le immagini delle prime pagine): estrazione generica, nessuna interpretazione. */
async function estrai(file) {
  try {
    if (/^image\//.test(file.type)) return { immagini: [{ tipo: file.type, base64: await b64(file) }] };
    const lib = await pdfjs(), pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    let testo = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
      const pg = await pdf.getPage(i), tc = await pg.getTextContent(); let riga = '', out = [], y0 = null;
      for (const it of tc.items) { const y = Math.round(it.transform[5]); if (y0 !== null && Math.abs(y - y0) > 3) { out.push(riga); riga = ''; } riga += (riga ? ' ' : '') + it.str; y0 = y; }
      out.push(riga); testo += '\n--- Pagina ' + i + ' ---\n' + out.join('\n');
    }
    if (testo.replace(/\s|-|Pagina \d+/g, '').length >= 80) return { testo };
    const immagini = [];
    for (let i = 1; i <= Math.min(pdf.numPages, 6); i++) {
      const pg = await pdf.getPage(i), vp = pg.getViewport({ scale: 1.8 }), cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      immagini.push({ tipo: 'image/jpeg', base64: await b64(await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85))) });
    }
    return { immagini };
  } catch (e) { return { errore: true }; }
}
const MAX_BINARIO = 15 * 1024 * 1024;
const comeBase64 = f => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = ko; r.readAsDataURL(f); });
async function mandaFile(f, scopo, binario) {
  const base = { t: 'file', scopo, nome: f.name, tipo: f.type, dimensione: f.size };
  if (binario) { if (f.size > MAX_BINARIO) return mostraErrore('File troppo grande (massimo 15 MB).'); return invia(Object.assign(base, { dati: await comeBase64(f) })); }
  const doc = scopo === 'importa' && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name) || /^image\//.test(f.type));
  invia(Object.assign(base, doc ? { estratto: await estrai(f) } : { testo: await f.text() }));
}
function scegliFile({ accept, scopo, binario }) {
  const i = document.createElement('input'); i.type = 'file'; i.accept = accept;
  i.addEventListener('change', () => { const f = i.files && i.files[0]; if (f) mandaFile(f, scopo, binario); });
  i.click();
}
// trascinare un file sulla zona di importazione equivale a sceglierlo
document.addEventListener('dragover', ev => { const z = ev.target.closest && ev.target.closest('#drop'); if (z) { ev.preventDefault(); z.style.outline = '2px dashed var(--tape)'; } });
document.addEventListener('dragleave', ev => { const z = ev.target.closest && ev.target.closest('#drop'); if (z && !z.contains(ev.relatedTarget)) z.style.outline = ''; });
document.addEventListener('drop', ev => {
  const z = ev.target.closest && ev.target.closest('#drop'); if (!z) return; ev.preventDefault(); z.style.outline = '';
  const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0]; if (f) mandaFile(f, 'importa');
});

/* ---------------- suggerimenti (icone «i») ---------------- */
(() => {
  const tip = document.createElement('div'); tip.id = 'infotip'; tip.setAttribute('role', 'tooltip'); tip.setAttribute('aria-hidden', 'true');
  // «popover»: il fumetto sta nel livello più alto, sopra anche alle finestre aperte (altrimenti resterebbe dietro)
  if (tip.showPopover) tip.setAttribute('popover', 'manual');
  document.body.appendChild(tip);
  const sopra = () => { if (!tip.showPopover) return; try { if (tip.matches(':popover-open')) tip.hidePopover(); tip.showPopover(); } catch (e) { } };
  let cur = null;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const show = el => {
    cur = el; const t = el.dataset.tipT;
    tip.innerHTML = (t ? '<b>' + esc(t) + '</b>' : '') + esc(el.dataset.tip);
    sopra(); tip.className = ''; tip.style.left = '0px'; tip.style.top = '0px';
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight, cx = r.left + r.width / 2;
    const left = Math.max(8, Math.min(cx - w / 2, innerWidth - w - 8)), giu = r.bottom + 10 + h < innerHeight - 8 || r.top - 10 - h < 8;
    tip.style.left = left + 'px'; tip.style.top = (giu ? r.bottom + 10 : r.top - 10 - h) + 'px';
    tip.style.setProperty('--ax', Math.max(14, Math.min(w - 14, cx - left)) + 'px');
    tip.className = (giu ? 'down' : 'up') + ' on'; tip.removeAttribute('aria-hidden');
  };
  const hide = () => { cur = null; tip.className = ''; tip.setAttribute('aria-hidden', 'true'); };
  document.addEventListener('mouseover', e => { const el = e.target.closest && e.target.closest('.info'); if (el && el !== cur) show(el); else if (!el && cur) hide(); });
  document.addEventListener('focusin', e => { if (e.target.classList && e.target.classList.contains('info')) show(e.target); });
  document.addEventListener('focusout', e => { if (e.target === cur) hide(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  addEventListener('scroll', hide, true);
})();

/* ---------------- avvio e modifiche dei colleghi ---------------- */
/** Chiamata dalla pagina iniziale (accesso.js) quando l'utente sceglie la carrozzeria. */
window.bootSede = v => {
  C.voce = v;
  invia({ t: 'avvio' });
  // un collega ha cambiato i dati: si ridisegna, ma non mentre una finestra è aperta
  let attesa = null;
  sb.channel('versioni-' + v.id).on('postgres_changes', { event: '*', schema: 'public', table: 'versioni', filter: 'carrozzeria_id=eq.' + v.id }, p => {
    if (p.new && p.new.versione <= C.versione) return; // è un nostro salvataggio, già mostrato
    clearTimeout(attesa);
    attesa = setTimeout(function prova() { if (C.catena.length || occupato()) { attesa = setTimeout(prova, 1000); return; } invia({ t: 'aggiorna' }); }, 300);
  }).subscribe();
};
})();
